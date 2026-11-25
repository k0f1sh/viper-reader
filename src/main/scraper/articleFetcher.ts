import { readFileSync } from "node:fs";
import BiwaScheme from "biwascheme";
import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
type JsonObject = { [key: string]: JsonValue };
export type ArticleResult = { bodyText: string; customData?: JsonObject };
export class ArticlePage {
  constructor(readonly text: string, readonly url: string) {}
}
class ArticleItem {
  constructor(readonly url: string) {}
}
export class EmptyArticleError extends Error {}

function string(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("文字列を指定してください。");
  return value;
}

function page(value: unknown): ArticlePage {
  if (!(value instanceof ArticlePage)) throw new TypeError("http-get の応答が必要です。");
  return value;
}

function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  return jsonObject(value);
}

function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("JSONオブジェクトを指定してください。");
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonValue(child)]));
}

export function extractArticleText(html: string, url: string): string {
  const virtualConsole = new VirtualConsole().forwardTo(console, {
    jsdomErrors: ["unhandled-exception", "resource-loading"]
  });
  const dom = new JSDOM(html, { url, virtualConsole });
  try {
    const text = new Readability(dom.window.document).parse()?.textContent;
    if (!text?.trim()) throw new EmptyArticleError("本文が見つかりません。");
    return text.replace(/\r\n?/g, "\n").replace(/[ \u00a0]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    dom.window.close();
  }
}

function interpreter() {
  return new BiwaScheme.Interpreter(error => { throw error; });
}

BiwaScheme.define_libfunc("item-url", 1, 1, ([item]) => {
  if (!(item instanceof ArticleItem)) throw new TypeError("記事が必要です。");
  return item.url;
});
BiwaScheme.define_libfunc("response-text", 1, 1, ([response]) => page(response).text);
BiwaScheme.define_libfunc("response-url", 1, 1, ([response]) => page(response).url);
BiwaScheme.define_libfunc("extract-article-text", 2, 2, ([html, url]) => extractArticleText(string(html), string(url)));

class FetchResult implements ArticleResult {
  constructor(readonly bodyText: string, readonly customData?: JsonObject) {}
}
BiwaScheme.define_libfunc("article-result", 1, 2, ([body, data]) =>
  new FetchResult(string(body), data === undefined ? undefined : jsonObject(data)));

interpreter().evaluate(`
  (define-macro (define-article-fetcher args . body)
    (if (and (list? args) (= (length args) 1) (symbol? (car args)) (pair? body))
        (cons 'define (cons (cons 'fetch-article args) body))
        (error "define-article-fetcher expects one parameter and a body")))
`);

const standardScript = readFileSync(new URL("../../../assets/standard-article.scm", import.meta.url), "utf8");

// Only app-owned scripts are evaluated. Local definitions and the HTTP callback
// are lexical so concurrent fetches never replace each other's bindings.
export function runArticleFetcher(
  url: string,
  getPage: (url: string) => Promise<ArticlePage>,
  source = standardScript
): Promise<ArticleResult> {
  return new Promise((resolve, reject) => {
    const runtime = interpreter();
    const fetcher = runtime.evaluate(`(lambda (http-get current-item)
      ${source}
      (fetch-article current-item))`);

    function finish(value: unknown) {
      if (value instanceof BiwaScheme.Pause) return;
      if (!(value instanceof FetchResult)) throw new TypeError("article-result が必要です。");
      resolve(value);
    }
    function httpGet(args: unknown[]) {
      if (args.length !== 1) throw new TypeError("http-get にはURLを1つ指定してください。");
      const target = string(args[0]);
      return new BiwaScheme.Pause(pause => {
        getPage(target).then(response => finish(pause.resume(response))).catch(reject);
      });
    }
    finish(runtime.invoke_closure(fetcher, [httpGet, new ArticleItem(url)]));
  });
}
