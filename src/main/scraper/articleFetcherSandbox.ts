import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { app, MessageChannelMain, session, WebContentsView, type Session } from "electron";
import { jsonObject, type ArticlePage, type ArticleResult } from "./articleFetcher.js";
import { extractArticleText } from "./extractArticleText.js";

const maxHtmlBytes = 10 * 1024 * 1024;
const maxJsonBytes = 1024 * 1024;
const maxConcurrentJobs = 2;
const waiting: (() => void)[] = [];
const active = new Map<string, () => void>();
const resources = new Map([
  ["/articleFetcherPage.js", new URL("./articleFetcherPage.js", import.meta.url)],
  ["/articleFetcher.js", new URL("./articleFetcher.js", import.meta.url)],
  ["/biwascheme.mjs", new URL("../../../node_modules/biwascheme/release/biwascheme.mjs", import.meta.url)]
]);
const csp = "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
let runnerSession: Session | undefined;
let quitting = false;

function allowedResource(value: string): boolean {
  const url = new URL(value);
  return active.has(url.origin) && !url.search && !url.hash && (url.pathname === "/" || resources.has(url.pathname));
}

function getSession(): Session {
  if (runnerSession) return runnerSession;
  const isolated = session.fromPartition("article-fetcher", { cache: false });
  isolated.setPermissionCheckHandler(() => false);
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setDevicePermissionHandler(() => false);
  isolated.on("will-download", event => event.preventDefault());
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowedResource(details.url) }));
  isolated.protocol.handle("https", async request => {
    if (request.method !== "GET" || !allowedResource(request.url)) return new Response(null, { status: 403 });
    const { pathname } = new URL(request.url);
    const headers = { "Content-Security-Policy": csp, "X-Content-Type-Options": "nosniff" };
    const resource = resources.get(pathname);
    if (resource) {
      return new Response(await readFile(resource, "utf8"), {
        headers: { ...headers, "Content-Type": "text/javascript; charset=utf-8" }
      });
    }
    return new Response('<!doctype html><meta charset="utf-8"><script type="module" src="/articleFetcherPage.js"></script>', {
      headers: { ...headers, "Content-Type": "text/html; charset=utf-8" }
    });
  });
  app.once("before-quit", () => {
    quitting = true;
    for (const cancel of active.values()) cancel();
    for (const start of waiting.splice(0)) start();
  });
  runnerSession = isolated;
  return isolated;
}

export type FetchArticle = (
  url: string,
  getPage: (url: string, signal: AbortSignal) => Promise<ArticlePage>
) => Promise<ArticleResult>;

export const runStandardArticleFetcher: FetchArticle = async (url, getPage) => {
  const source = await readFile(new URL("../../../assets/standard-article.scm", import.meta.url), "utf8");
  return runIsolatedArticleFetcher(url, getPage, source);
};

export function runIsolatedArticleFetcher(
  url: string,
  getPage: Parameters<FetchArticle>[1],
  source: string,
  timeoutMs = 30_000
): Promise<ArticleResult> {
  return new Promise((resolve, reject) => {
    function start() {
      if (quitting) {
        reject(new Error("アプリを終了しています。"));
        return;
      }
      const origin = `https://${randomUUID()}.invalid`;
      const abort = new AbortController();
      let view: WebContentsView | undefined;
      let channel: Electron.MessageChannelMain | undefined;
      let page: ArticlePage | undefined;
      let requested = false;
      let extracted = false;
      let settled = false;
      const startedAt = performance.now();
      const timer = setTimeout(() => finish(new Error("Schemeの記事取得がタイムアウトしました。")), timeoutMs);

      function finish(error: unknown, result?: ArticleResult) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        abort.abort();
        active.delete(origin);
        channel?.port1.close();
        channel?.port2.close();
        const contents = view?.webContents;
        view = undefined;
        if (contents && !contents.isDestroyed()) contents.close({ waitForBeforeUnload: false });
        console.info(`[Scheme] 記事取得${result ? "完了" : "失敗"} (${Math.round(performance.now() - startedAt)} ms)`);
        if (result) resolve(result);
        else reject(error);
        if (!quitting) waiting.shift()?.();
      }

      active.set(origin, () => finish(new Error("アプリを終了しています。")));
      try {
        view = new WebContentsView({
          webPreferences: {
            session: getSession(),
            preload: fileURLToPath(new URL("../../preload/articleFetcher.cjs", import.meta.url)),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
            devTools: false
          }
        });
        const contents = view.webContents;
        contents.setWindowOpenHandler(() => ({ action: "deny" }));
        contents.on("will-frame-navigate", event => event.preventDefault());
        contents.on("will-redirect", event => event.preventDefault());
        contents.on("will-attach-webview", event => event.preventDefault());
        contents.once("render-process-gone", () => finish(new Error("Schemeの実行プロセスが終了しました。")));
        contents.once("destroyed", () => finish(new Error("Schemeの実行環境が閉じられました。")));

        const { port1, port2 } = channel = new MessageChannelMain();
        port1.once("close", () => finish(new Error("Schemeとの通信が終了しました。")));
        port1.on("message", async ({ data }) => {
          if (settled) return;
          try {
            if (data?.kind === "get" && !requested && data.url === url) {
              requested = true;
              page = await getPage(url, abort.signal);
              if (!settled) port1.postMessage(page);
            } else if (data?.kind === "extract" && page && !extracted && data.html === page.text && data.url === page.url) {
              extracted = true;
              port1.postMessage(extractArticleText(page.text, page.url));
            } else if (data?.kind === "result") {
              const result = data.result;
              if (typeof result?.bodyText !== "string" || Buffer.byteLength(result.bodyText) > maxHtmlBytes) {
                throw new Error("Schemeの記事本文が不正です。");
              }
              const customData = result.customData === undefined ? undefined : jsonObject(result.customData);
              if (customData && Buffer.byteLength(JSON.stringify(customData)) > maxJsonBytes) {
                throw new Error("Schemeの追加データがサイズ上限を超えています。");
              }
              finish(null, { bodyText: result.bodyText, customData });
            } else if (data?.kind === "error") {
              throw new Error("Schemeの評価に失敗しました。");
            } else {
              throw new Error("Schemeの記事取得要求が許可範囲外です。");
            }
          } catch (error) {
            finish(error);
          }
        });
        port1.start();
        console.info("[Scheme] 記事取得開始");
        void contents.loadURL(origin).then(() => {
          if (settled) return;
          contents.postMessage("article-fetcher:port", null, [port2]);
          port1.postMessage({ url, source });
        }).catch(finish);
      } catch (error) {
        finish(error);
      }
    }

    if (active.size >= maxConcurrentJobs) waiting.push(start);
    else start();
  });
}
