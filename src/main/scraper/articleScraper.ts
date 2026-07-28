import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";
import { CHROME_USER_AGENT } from "../network/httpIdentity.js";
import { readResponseText, safeFetch } from "../network/safeFetch.js";
import { checkRobotsTxt } from "./robotsTxtChecker.js";

export type ScrapingResult = {
  success: boolean;
  contentText: string;
  reason?: "robots_disallowed" | "fetch_failed" | "parse_failed" | "no_content";
  elapsedMs: number;
  contentSize: number; // 取得したHTMLのサイズ（バイト数）
  robotsResult: "allowed" | "disallowed" | "fetch_error" | "fetch_timeout";
};

const maxArticleBytes = 10 * 1024 * 1024;

/**
 * 指定されたURLから記事の本文をスクレイピングして抽出します。
 * robots.txtで禁止されている場合はスクレイピングをスキップします。
 */
export async function scrapeArticle(targetUrl: string): Promise<ScrapingResult> {
  console.log(`[Scraper Start] URL: ${targetUrl}`);
  const startTime = performance.now();
  let contentSize = 0;

  // 1. robots.txtのチェック
  const robotsCheck = await checkRobotsTxt(targetUrl);
  if (!robotsCheck.allowed) {
    console.warn(`robots.txtによりスクレイピングが禁止されています: ${targetUrl}`);
    return {
      success: false,
      contentText: "",
      reason: "robots_disallowed",
      elapsedMs: Math.round(performance.now() - startTime),
      contentSize: 0,
      robotsResult: "disallowed"
    };
  }

  // 2. HTMLの取得
  let html = "";
  try {
    const response = await safeFetch(targetUrl, {
      headers: {
        "User-Agent": CHROME_USER_AGENT
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
        robotsResult: robotsCheck.reason
      };
    }
    const articleResponse = await readResponseText(response, maxArticleBytes);
    html = articleResponse.text;
    contentSize = articleResponse.byteLength;
  } catch (error) {
    console.error(`HTMLのフェッチに失敗しました: ${targetUrl}`, error);
    return {
      success: false,
      contentText: "",
      reason: "fetch_failed",
      elapsedMs: Math.round(performance.now() - startTime),
      contentSize: 0,
      robotsResult: robotsCheck.reason
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
        robotsResult: robotsCheck.reason
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
      robotsResult: robotsCheck.reason
    };
  } catch (error) {
    console.error(`HTMLのパースに失敗しました: ${targetUrl}`, error);
    return {
      success: false,
      contentText: "",
      reason: "parse_failed",
      elapsedMs: Math.round(performance.now() - startTime),
      contentSize,
      robotsResult: robotsCheck.reason
    };
  }
}
