import _robotsParser from "robots-parser";

// CommonJSのデフォルトエクスポート型定義を補正
const robotsParser = _robotsParser as unknown as (url: string, robotstxt: string) => {
  isAllowed(url: string, ua?: string): boolean | undefined;
  isDisallowed(url: string, ua?: string): boolean | undefined;
};

const CHROME_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const BOT_NAME = "*";

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
      response = await fetch(robotsUrl, {
        headers: {
          "User-Agent": CHROME_USER_AGENT
        },
        signal: AbortSignal.timeout(5000) // 5秒タイムアウト
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

    const robotsTxtContent = await response.text();
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
