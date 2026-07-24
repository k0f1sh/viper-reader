import crypto from "node:crypto";
import type { ThreadDetail, ThreadPost } from "../../shared/types.js";
import type { LlmRequestLogWrite } from "../db/repository.js";
import { buildVipThreadResponsePrompt } from "../prompts/vipThreadResponsePrompt.js";
import { getActiveModel } from "../settings/settingsService.js";
import { VIP_SYSTEM_INSTRUCTION } from "./promptParts.js";
import { createLogId, generateJson, missingApiKeyMessage, resolveApiKey } from "./genaiClient.js";
import { threadPostArraySchema } from "./schemas.js";

export type ThreadResponseGenerationResult = {
  posts: ThreadPost[];
  log: LlmRequestLogWrite | null;
};

/**
 * 記事本文が長すぎる場合の最大文字数。
 * これを超える場合は先頭から切り詰め、その旨をプロンプト内で明示する。
 */
const MAX_BODY_CHARS = 6000;
const MAX_BODY_EXCERPT_CHARS = 4000;

export async function generateThreadResponses(
  thread: ThreadDetail,
  options: {
    residentPrompt: string | null;
    promptHash: string;
    scrapedBody: string | null;
    articleSummary: string | null;
  }
): Promise<ThreadResponseGenerationResult> {
  const modelToUse = getActiveModel();
  const startedAt = new Date().toISOString();

  // 要約がある場合も本文抜粋を併用し、短い要約だけでは落ちやすい
  // 技術的な詳細や実装上の注意点をレス生成へ渡す。
  const articleContext = buildArticleContext({
    summary: options.articleSummary,
    scrapedBody: options.scrapedBody,
    maxBodyChars: MAX_BODY_CHARS,
    maxExcerptChars: MAX_BODY_EXCERPT_CHARS
  });

  const prompt = buildVipThreadResponsePrompt({
    vipTitle: thread.vipTitle,
    originalTitle: thread.originalTitle,
    url: thread.url,
    rssBody: thread.posts[0]?.body ?? "",
    scrapedBody: articleContext,
    publishedAt: thread.publishedAt,
    residentPrompt: options.residentPrompt
  });

  if (!resolveApiKey()) {
    const finishedAt = new Date().toISOString();
    return {
      posts: [],
      log: createLlmLog({
        feedId: thread.feedId,
        promptHash: options.promptHash,
        status: "skipped",
        itemCount: 1,
        promptChars: prompt.length,
        responseChars: 0,
        usageMetadata: undefined,
        errorMessage: missingApiKeyMessage,
        startedAt,
        finishedAt,
        model: modelToUse
      })
    };
  }

  const result = await generateJson<ThreadPost[]>({
    model: modelToUse,
    purpose: "thread_response",
    systemInstruction: VIP_SYSTEM_INSTRUCTION,
    contents: prompt,
    responseSchema: threadPostArraySchema,
    timeoutMs: 45000,
    parse: (text) => {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) throw new Error("Gemini thread response is not an array");
      return validateGeneratedPosts(parsed);
    }
  });

  const finishedAt = new Date().toISOString();
  const posts = result.value ?? [];

  return {
    posts,
    log: createLlmLog({
      feedId: thread.feedId,
      promptHash: options.promptHash,
      status: result.errorMessage ? "error" : "success",
      itemCount: posts.length,
      promptChars: result.promptChars,
      responseChars: result.responseText.length,
      usageMetadata: result.usageMetadata,
      errorMessage: result.errorMessage,
      startedAt,
      finishedAt,
      model: modelToUse
    })
  };
}

/**
 * 記事コンテキスト文字列を組み立てる。
 * - summary と scrapedBody があれば、要約と本文抜粋を併せて返す。
 * - summary がなければ scrapedBody を最大 maxBodyChars 文字に切り詰めて返す。
 * - 切り詰めた場合は「切り詰めた」ことをプロンプト内に明示する。
 * - summary と scrapedBody がどちらもなければ null を返す。
 */
function buildArticleContext(params: {
  summary: string | null;
  scrapedBody: string | null;
  maxBodyChars: number;
  maxExcerptChars: number;
}): string | null {
  if (params.summary && params.scrapedBody) {
    const excerpt = params.scrapedBody.slice(0, params.maxExcerptChars);
    const truncationNote = params.scrapedBody.length > params.maxExcerptChars
      ? `\n\n[※ 本文抜粋は先頭 ${params.maxExcerptChars} 文字で切り詰めています。抜粋より後の内容は断言しないでください。]`
      : "";
    return `【記事要約】\n${params.summary}\n\n【記事本文の抜粋】\n${excerpt}${truncationNote}`;
  }

  if (params.summary) {
    return `【記事要約】\n${params.summary}`;
  }

  if (!params.scrapedBody) {
    return null;
  }

  if (params.scrapedBody.length <= params.maxBodyChars) {
    return params.scrapedBody;
  }

  return (
    params.scrapedBody.slice(0, params.maxBodyChars) +
    `\n\n[※ 本文が長いため先頭 ${params.maxBodyChars} 文字に切り詰めています。続きの内容については「そこはソースから判断できない」として扱ってください。]`
  );
}

function validateGeneratedPosts(parsed: unknown[]): ThreadPost[] {
  const posts: ThreadPost[] = [];

  for (const item of parsed) {
    if (!isRecord(item)) {
      continue;
    }

    const body = normalizeString(item.body, "").slice(0, 500);
    if (!body.trim()) {
      continue;
    }

    posts.push({
      no: 2 + posts.length,
      name: normalizeString(item.name, "以下、名無しにかわりましてVIPがお送りします").slice(0, 80),
      mail: normalizeMail(item.mail),
      date: normalizeString(item.date, createFallbackDate()).slice(0, 40),
      id: normalizeId(item.id),
      body
    });

    if (posts.length >= 15) {
      break;
    }
  }

  return posts;
}

function normalizeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  return value.trim();
}

function normalizeMail(value: unknown): string {
  return normalizeOptionalString(value)?.slice(0, 20) ?? "sage";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeId(value: unknown): string {
  if (typeof value !== "string") {
    return createFallbackId();
  }
  const cleanId = value.trim().replace(/^ID:/i, "");
  if (/^[A-Za-z0-9]{8}$/.test(cleanId)) {
    return cleanId;
  }
  return createFallbackId();
}

function createLlmLog(params: {
  feedId: string;
  promptHash: string;
  model: string;
  status: "success" | "error" | "skipped";
  itemCount: number;
  promptChars: number;
  responseChars: number;
  usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; cachedContentTokenCount?: number } | undefined;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
}): LlmRequestLogWrite {
  return {
    id: createLogId("llm", params.feedId, params.finishedAt),
    feedId: params.feedId,
    purpose: "thread_response",
    model: params.model,
    promptHash: params.promptHash,
    status: params.status,
    requestCount: params.status === "skipped" ? 0 : 1,
    itemCount: params.itemCount,
    promptChars: params.promptChars,
    responseChars: params.responseChars,
    promptTokenCount: params.usageMetadata?.promptTokenCount ?? null,
    candidatesTokenCount: params.usageMetadata?.candidatesTokenCount ?? null,
    totalTokenCount: params.usageMetadata?.totalTokenCount ?? null,
    cachedContentTokenCount: params.usageMetadata?.cachedContentTokenCount ?? null,
    errorMessage: params.errorMessage,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt
  };
}

function createFallbackDate(): string {
  return "2010/01/01(金) 00:00:00.00";
}

function createFallbackId(): string {
  return crypto.randomBytes(4).toString("hex");
}
