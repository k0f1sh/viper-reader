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
const robotsPolicyTtlMs = 5 * 60 * 1000;
const robotsFailureTtlMs = 30 * 1000;

type RobotsRules = ReturnType<typeof robotsParser>;

type RobotsPolicy =
  | { kind: "rules"; rules: RobotsRules }
  | { kind: "allow"; reason: "fetch_error" }
  | { kind: "block"; reason: "fetch_error" | "fetch_timeout" };

type CachedRobotsPolicy = {
  expiresAt: number;
  policy: RobotsPolicy;
};

const robotsPolicyCache = new Map<string, CachedRobotsPolicy>();
const pendingRobotsPolicies = new Map<string, Promise<RobotsPolicy>>();

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
    const policy = await getRobotsPolicy(parsedUrl);

    if (policy.kind === "allow") {
      return { allowed: true, reason: policy.reason };
    }
    if (policy.kind === "block") {
      return { allowed: false, reason: policy.reason };
    }

    const allowed = policy.rules.isAllowed(targetUrl, BOT_NAME) ?? true;
    return { allowed, reason: allowed ? "allowed" : "disallowed" };
  } catch (error) {
    console.warn(`robots.txtを確認できないためスクレイピングを停止します: ${targetUrl}`, error);
    return {
      allowed: false,
      reason: "fetch_error"
    };
  }
}

async function getRobotsPolicy(targetUrl: URL): Promise<RobotsPolicy> {
  const cacheKey = targetUrl.origin;
  const cached = robotsPolicyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.policy;
  }
  if (cached) {
    robotsPolicyCache.delete(cacheKey);
  }

  const pending = pendingRobotsPolicies.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = fetchRobotsPolicy(targetUrl);
  pendingRobotsPolicies.set(cacheKey, request);
  try {
    const policy = await request;
    robotsPolicyCache.set(cacheKey, {
      policy,
      expiresAt: Date.now() + (policy.kind === "block" ? robotsFailureTtlMs : robotsPolicyTtlMs)
    });
    return policy;
  } finally {
    pendingRobotsPolicies.delete(cacheKey);
  }
}

async function fetchRobotsPolicy(targetUrl: URL): Promise<RobotsPolicy> {
  const robotsUrl = `${targetUrl.origin}/robots.txt`;
  let response: Response;
  try {
    response = await safeFetch(robotsUrl, {
      headers: {
        "User-Agent": ARTICLE_FETCH_USER_AGENT
      },
      timeoutMs: 5_000
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    return {
      kind: "block",
      reason: isTimeout ? "fetch_timeout" : "fetch_error"
    };
  }

  if (response.status >= 400 && response.status <= 499) {
    await response.body?.cancel();
    return { kind: "allow", reason: "fetch_error" };
  }
  if (!response.ok) {
    await response.body?.cancel();
    return { kind: "block", reason: "fetch_error" };
  }

  try {
    const { text: robotsTxtContent } = await readResponseText(response, maxRobotsTxtBytes);
    return { kind: "rules", rules: robotsParser(robotsUrl, robotsTxtContent) };
  } catch {
    return { kind: "block", reason: "fetch_error" };
  }
}

/**
 * 下位互換用 (単純な真偽値が必要な場合)
 */
export async function isScrapingAllowed(targetUrl: string): Promise<boolean> {
  const result = await checkRobotsTxt(targetUrl);
  return result.allowed;
}
