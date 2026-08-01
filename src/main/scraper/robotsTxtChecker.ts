import _robotsParser from "robots-parser";
import { ARTICLE_FETCH_USER_AGENT } from "../network/httpIdentity.js";
import { readResponseText, safeFetch } from "../network/safeFetch.js";

// CommonJSのデフォルトエクスポート型定義を補正
const robotsParser = _robotsParser as unknown as (url: string, robotstxt: string) => {
  isAllowed(url: string, ua?: string): boolean | undefined;
  isDisallowed(url: string, ua?: string): boolean | undefined;
};

const BOT_NAME = "*";
const maxRobotsTxtBytes = 1024 * 1024;

export type RobotsCheckResult = {
  allowed: boolean;
  reason: "allowed" | "disallowed" | "fetch_error" | "fetch_timeout";
};

/**
 * robots.txtをチェックし、指定されたURLがスクレイピング可能か確認します。
 * 詳しい結果情報を RobotsCheckResult として返します。
 */
export async function checkRobotsTxt(targetUrl: string): Promise<RobotsCheckResult> {
  try {
    const parsedUrl = new URL(targetUrl);
    const robotsUrl = `${parsedUrl.protocol}//${parsedUrl.host}/robots.txt`;

    let response: Response;
    try {
      response = await safeFetch(robotsUrl, {
        headers: {
          "User-Agent": ARTICLE_FETCH_USER_AGENT
        },
        timeoutMs: 5_000
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      return {
        allowed: true,
        reason: isTimeout ? "fetch_timeout" : "fetch_error"
      };
    }

    if (!response.ok) {
      return {
        allowed: true,
        reason: "fetch_error"
      };
    }

    const { text: robotsTxtContent } = await readResponseText(response, maxRobotsTxtBytes);
    const robots = robotsParser(robotsUrl, robotsTxtContent);
    const allowed = robots.isAllowed(targetUrl, BOT_NAME) ?? true;

    return {
      allowed,
      reason: allowed ? "allowed" : "disallowed"
    };
  } catch (error) {
    console.warn(`robots.txtの取得に失敗したためデフォルト許可します: ${targetUrl}`, error);
    return {
      allowed: true,
      reason: "fetch_error"
    };
  }
}

/**
 * 下位互換用 (単純な真偽値が必要な場合)
 */
export async function isScrapingAllowed(targetUrl: string): Promise<boolean> {
  const result = await checkRobotsTxt(targetUrl);
  return result.allowed;
}
