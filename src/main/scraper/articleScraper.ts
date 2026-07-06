import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { checkRobotsTxt } from "./robotsTxtChecker.js";

const CHROME_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

export type ScrapingResult = {
  success: boolean;
  contentText: string;
  reason?: "robots_disallowed" | "fetch_failed" | "parse_failed" | "no_content";
  elapsedMs: number;
  contentSize: number; // 取得したHTMLのサイズ（バイト数）
  robotsResult: "allowed" | "disallowed" | "fetch_error" | "fetch_timeout";
};

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
    const response = await fetch(targetUrl, {
      headers: {
        "User-Agent": CHROME_USER_AGENT
      },
      signal: AbortSignal.timeout(10000) // 10秒タイムアウト
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
    html = await response.text();
    contentSize = Buffer.byteLength(html, "utf8"); // HTMLのバイトサイズ
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
    const dom = new JSDOM(html, { url: targetUrl });
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
