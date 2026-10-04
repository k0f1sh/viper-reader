import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { ARTICLE_FETCH_USER_AGENT } from "../network/httpIdentity.js";
import { readResponseText, safeFetch } from "../network/safeFetch.js";
import { checkRobotsTxt } from "./robotsTxtChecker.js";

export type ScrapingResult = {
  success: boolean;
  contentText: string;
  reason?: "robots_disallowed" | "robots_unavailable" | "fetch_failed" | "parse_failed" | "no_content";
  elapsedMs: number;
  contentSize: number; // 取得したHTMLのサイズ（バイト数）
  robotsResult: "allowed" | "disallowed" | "fetch_error" | "fetch_timeout";
};

const maxArticleBytes = 10 * 1024 * 1024;

class RobotsCheckBlockedError extends Error {
  constructor(readonly result: Awaited<ReturnType<typeof checkRobotsTxt>>) {
    super(`robots.txtの確認結果により取得を停止しました: ${result.reason}`);
  }
}

/**
 * 指定されたURLから記事の本文をスクレイピングして抽出します。
 * robots.txtで禁止されている場合はスクレイピングをスキップします。
 */
export async function scrapeArticle(targetUrl: string): Promise<ScrapingResult> {
  console.log(`[Scraper Start] URL: ${targetUrl}`);
  const startTime = performance.now();
  let contentSize = 0;

  try {
    const parsedTargetUrl = new URL(targetUrl);
    if (parsedTargetUrl.protocol !== "http:" && parsedTargetUrl.protocol !== "https:") {
      throw new Error(`HTTPまたはHTTPS以外のURLは取得できません: ${parsedTargetUrl.protocol}`);
    }
  } catch (error) {
    console.error(`記事URLが不正なため取得できません: ${targetUrl}`, error);
    return {
      success: false,
      contentText: "",
      reason: "fetch_failed",
      elapsedMs: Math.round(performance.now() - startTime),
      contentSize: 0,
      robotsResult: "fetch_error"
    };
  }

  // 1. robots.txtのチェック
  const robotsCheck = await checkRobotsTxt(targetUrl);
  if (!robotsCheck.allowed) {
    console.warn(`robots.txtの確認結果によりスクレイピングを停止します: ${targetUrl}`);
    return {
      success: false,
      contentText: "",
      reason: robotsCheck.reason === "disallowed" ? "robots_disallowed" : "robots_unavailable",
      elapsedMs: Math.round(performance.now() - startTime),
      contentSize: 0,
      robotsResult: robotsCheck.reason
    };
  }
  let robotsResult = robotsCheck.reason;

  // 2. HTMLの取得
  let html = "";
  try {
    const response = await safeFetch(targetUrl, {
      beforeRedirect: async (nextUrl) => {
        const redirectRobotsCheck = await checkRobotsTxt(nextUrl.href);
        if (!redirectRobotsCheck.allowed) {
          throw new RobotsCheckBlockedError(redirectRobotsCheck);
        }
        if (redirectRobotsCheck.reason !== "allowed") {
          robotsResult = redirectRobotsCheck.reason;
        }
      },
      headers: {
        "User-Agent": ARTICLE_FETCH_USER_AGENT
      },
      timeoutMs: 10_000
    });

    if (!response.ok) {
      return {
        success: false,
        contentText: "",
        reason: "fetch_failed",
        elapsedMs: Math.round(performance.now() - startTime),
        contentSize: 0,
        robotsResult
      };
    }
    const articleResponse = await readResponseText(response, maxArticleBytes);
    html = articleResponse.text;
    contentSize = articleResponse.byteLength;
  } catch (error) {
    if (error instanceof RobotsCheckBlockedError) {
      console.warn(`リダイレクト先のrobots.txt確認結果によりスクレイピングを停止します: ${targetUrl}`);
      return {
        success: false,
        contentText: "",
        reason: error.result.reason === "disallowed" ? "robots_disallowed" : "robots_unavailable",
        elapsedMs: Math.round(performance.now() - startTime),
        contentSize: 0,
        robotsResult: error.result.reason
      };
    }
    console.error(`HTMLのフェッチに失敗しました: ${targetUrl}`, error);
    return {
      success: false,
      contentText: "",
      reason: "fetch_failed",
      elapsedMs: Math.round(performance.now() - startTime),
      contentSize: 0,
      robotsResult
    };
  }

  // 3. Readabilityによる本文抽出
  try {
    const virtualConsole = new VirtualConsole().forwardTo(console, {
      jsdomErrors: ["unhandled-exception", "resource-loading"]
    });
    const dom = new JSDOM(html, { url: targetUrl, virtualConsole });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (!article || !article.textContent?.trim()) {
      return {
        success: false,
        contentText: "",
        reason: "no_content",
        elapsedMs: Math.round(performance.now() - startTime),
        contentSize,
        robotsResult
      };
    }

    // 不要な空白文字や過剰な改行を整理してプレーンテキストを抽出
    const cleanText = article.textContent
      .replace(/\r\n?/g, "\n")
      .replace(/[ \u00a0]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      success: true,
      contentText: cleanText,
      elapsedMs: Math.round(performance.now() - startTime),
      contentSize,
      robotsResult
    };
  } catch (error) {
    console.error(`HTMLのパースに失敗しました: ${targetUrl}`, error);
    return {
      success: false,
      contentText: "",
      reason: "parse_failed",
      elapsedMs: Math.round(performance.now() - startTime),
      contentSize,
      robotsResult
    };
  }
}
