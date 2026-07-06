import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { appInfo } from "../../shared/appInfo.js";
import type { ThreadDetail, ThreadPost } from "../../shared/types.js";
import type { LlmRequestLogWrite } from "../db/repository.js";
import { buildVipThreadResponsePrompt } from "../prompts/vipThreadResponsePrompt.js";

export type ThreadResponseGenerationResult = {
  posts: ThreadPost[];
  log: LlmRequestLogWrite | null;
};

type UsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export async function generateThreadResponses(
  thread: ThreadDetail,
  options: {
    residentPrompt: string | null;
    promptHash: string;
    scrapedBody: string | null;
  }
): Promise<ThreadResponseGenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const startedAt = new Date().toISOString();
  const prompt = buildVipThreadResponsePrompt({
    vipTitle: thread.vipTitle,
    originalTitle: thread.originalTitle,
    url: thread.url,
    rssBody: thread.posts[0]?.body ?? "",
    scrapedBody: options.scrapedBody,
    publishedAt: thread.publishedAt,
    residentPrompt: options.residentPrompt
  });

  if (!apiKey) {
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
        errorMessage: "GEMINI_API_KEY or GOOGLE_API_KEY is not set",
        startedAt,
        finishedAt
      })
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  let responseText = "";

  console.log(`[LLM Request Start] Model: ${appInfo.model} | Purpose: thread_response`);

  try {
    const response = await ai.models.generateContent({
      model: appInfo.model,
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });
    responseText = response.text ?? "";
    const posts = validateGeneratedPosts(parseJsonArray(responseText));
    const finishedAt = new Date().toISOString();

    return {
      posts,
      log: createLlmLog({
        feedId: thread.feedId,
        promptHash: options.promptHash,
        status: "success",
        itemCount: posts.length,
        promptChars: prompt.length,
        responseChars: responseText.length,
        usageMetadata: response.usageMetadata,
        errorMessage: null,
        startedAt,
        finishedAt
      })
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    return {
      posts: [],
      log: createLlmLog({
        feedId: thread.feedId,
        promptHash: options.promptHash,
        status: "error",
        itemCount: 1,
        promptChars: prompt.length,
        responseChars: responseText.length,
        usageMetadata: undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt
      })
    };
  }
}

function parseJsonArray(responseText: string): unknown[] {
  const trimmed = responseText.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(withoutFence) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("Gemini thread response is not an array");
  }

  return parsed;
}

function validateGeneratedPosts(parsed: unknown[]): ThreadPost[] {
  const posts: ThreadPost[] = [];
  const usedNumbers = new Set<number>();

  for (const item of parsed) {
    if (!isRecord(item)) {
      continue;
    }

    const no = normalizePostNumber(item.no, usedNumbers);
    usedNumbers.add(no);
    posts.push({
      no,
      name: normalizeString(item.name, "以下、名無しにかわりましてVIPがお送りします").slice(0, 80),
      mail: normalizeOptionalString(item.mail)?.slice(0, 20),
      date: normalizeString(item.date, createFallbackDate()).slice(0, 40),
      id: normalizeId(item.id),
      body: normalizeString(item.body, "").slice(0, 500)
    });

    if (posts.length >= 15) {
      break;
    }
  }

  return posts.filter((post) => post.body.trim().length > 0);
}

function normalizePostNumber(value: unknown, usedNumbers: Set<number>): number {
  const parsedNumber = typeof value === "number" ? value : Number(value);
  let no = Number.isFinite(parsedNumber) ? Math.max(2, Math.floor(parsedNumber)) : 2;

  while (usedNumbers.has(no)) {
    no += 1;
  }

  return no;
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
  status: "success" | "error" | "skipped";
  itemCount: number;
  promptChars: number;
  responseChars: number;
  usageMetadata: UsageMetadata | undefined;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
}): LlmRequestLogWrite {
  return {
    id: createLogId("llm", params.feedId, params.finishedAt),
    feedId: params.feedId,
    purpose: "thread_response",
    model: appInfo.model,
    promptHash: params.promptHash,
    status: params.status,
    requestCount: params.status === "skipped" ? 0 : 1,
    itemCount: params.itemCount,
    promptChars: params.promptChars,
    responseChars: params.responseChars,
    promptTokenCount: params.usageMetadata?.promptTokenCount ?? null,
    candidatesTokenCount: params.usageMetadata?.candidatesTokenCount ?? null,
    totalTokenCount: params.usageMetadata?.totalTokenCount ?? null,
    errorMessage: params.errorMessage,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt
  };
}

function createLogId(prefix: string, feedId: string, value: string): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${prefix}:${feedId}:${value}:${crypto.randomUUID()}`)
    .digest("hex")
    .slice(0, 20);
  return `${prefix}:${hash}`;
}

function createFallbackDate(): string {
  return "2010/01/01(金) 00:00:00.00";
}

function createFallbackId(): string {
  return crypto.randomBytes(4).toString("hex");
}
