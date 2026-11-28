import { ARTICLE_FETCH_USER_AGENT } from "../network/httpIdentity.js";
import { readResponseText, safeFetch } from "../network/safeFetch.js";
import { ArticlePage, type ArticleResult } from "./articleFetcher.js";
import { EmptyArticleError } from "./extractArticleText.js";
import type { FetchArticle } from "./articleFetcherSandbox.js";
import { checkRobotsTxt, type RobotsCheckResult } from "./robotsTxtChecker.js";

export type ScrapingResult = {
  success: boolean;
  contentText: string;
  customData?: ArticleResult["customData"];
  reason?: "robots_disallowed" | "robots_unavailable" | "fetch_failed" | "parse_failed" | "no_content";
  elapsedMs: number;
  contentSize: number;
  robotsResult: RobotsCheckResult["reason"];
};

const maxArticleBytes = 10 * 1024 * 1024;

class ArticleFetchError extends Error {
  constructor(readonly reason: NonNullable<ScrapingResult["reason"]>, cause?: unknown) {
    super(reason, { cause });
  }
}

export async function scrapeArticle(targetUrl: string, fetchArticle?: FetchArticle): Promise<ScrapingResult> {
  const startTime = performance.now();
  let contentSize = 0;
  let robotsResult: RobotsCheckResult["reason"] = "fetch_error";

  async function checkRobots(url: string) {
    const result = await checkRobotsTxt(url);
    if (!result.allowed) {
      robotsResult = result.reason;
      throw new ArticleFetchError(result.reason === "disallowed" ? "robots_disallowed" : "robots_unavailable");
    }
    return result.reason;
  }

  async function getPage(url: string, signal: AbortSignal): Promise<ArticlePage> {
    try {
      signal.throwIfAborted();
      robotsResult = await checkRobots(url);
      signal.throwIfAborted();
      let finalUrl = url;
      const response = await safeFetch(url, {
        beforeRedirect: async (nextUrl) => {
          signal.throwIfAborted();
          const reason = await checkRobots(nextUrl.href);
          if (reason !== "allowed") robotsResult = reason;
          finalUrl = nextUrl.href;
        },
        headers: { "User-Agent": ARTICLE_FETCH_USER_AGENT },
        timeoutMs: 10_000,
        signal
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status}`);
      }
      const body = await readResponseText(response, maxArticleBytes);
      contentSize += body.byteLength;
      return new ArticlePage(body.text, response.url || finalUrl);
    } catch (error) {
      if (error instanceof ArticleFetchError) throw error;
      throw new ArticleFetchError("fetch_failed", error);
    }
  }

  const metrics = () => ({
    elapsedMs: Math.round(performance.now() - startTime), contentSize, robotsResult
  });
  try {
    const target = URL.parse(targetUrl);
    if (!target || !["http:", "https:"].includes(target.protocol)) {
      throw new ArticleFetchError("fetch_failed");
    }
    const run = fetchArticle ?? (await import("./articleFetcherSandbox.js")).runStandardArticleFetcher;
    const result = await run(targetUrl, getPage);
    return {
      success: true, contentText: result.bodyText,
      ...(result.customData && { customData: result.customData }), ...metrics()
    };
  } catch (error) {
    const reason = error instanceof ArticleFetchError ? error.reason
      : error instanceof EmptyArticleError ? "no_content" : "parse_failed";
    console.warn(`記事を取得できませんでした: ${URL.parse(targetUrl)?.origin ?? ""}`, error instanceof ArticleFetchError ? error.reason : error);
    return { success: false, contentText: "", reason, ...metrics() };
  }
}
