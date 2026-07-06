import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import { appInfo } from "../../shared/appInfo.js";
import type { LlmRequestLogWrite, UnconvertedFeedItem, VipTitleWrite } from "../db/repository.js";
import { buildVipTitlePrompt, vipTitlePromptHash } from "../prompts/vipTitlePrompt.js";

export type TitleTransformResult = {
  titles: VipTitleWrite[];
  failedCount: number;
  skippedCount: number;
  logs: LlmRequestLogWrite[];
};

type GeminiTitleResponse = Array<{
  feedItemId: string;
  vipTitle: string;
}>;

type UsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

const titleBatchSize = 12;

export async function transformTitlesToVipStyle(
  feedId: string,
  feedTitle: string,
  items: UnconvertedFeedItem[]
): Promise<TitleTransformResult> {
  if (items.length === 0) {
    return {
      titles: [],
      failedCount: 0,
      skippedCount: 0,
      logs: []
    };
  }

  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    const now = new Date().toISOString();
    return {
      titles: [],
      failedCount: 0,
      skippedCount: items.length,
      logs: [
        {
          id: createLogId("llm-skip", feedId, now),
          feedId,
          purpose: "title_transform",
          model: appInfo.model,
          promptHash: vipTitlePromptHash,
          status: "skipped",
          requestCount: 0,
          itemCount: items.length,
          promptChars: 0,
          responseChars: 0,
          promptTokenCount: null,
          candidatesTokenCount: null,
          totalTokenCount: null,
          errorMessage: "GEMINI_API_KEY or GOOGLE_API_KEY is not set",
          startedAt: now,
          finishedAt: now
        }
      ]
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  const titles: VipTitleWrite[] = [];
  const logs: LlmRequestLogWrite[] = [];
  let failedCount = 0;

  for (const chunk of chunkItems(items, titleBatchSize)) {
    const startedAt = new Date().toISOString();
    const prompt = buildVipTitlePrompt(feedTitle, chunk);
    let responseText = "";
    console.log(`[LLM Request Start] Model: ${appInfo.model} | Purpose: title_transformation`);

    try {
      const response = await ai.models.generateContent({
        model: appInfo.model,
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      });
      responseText = response.text ?? "";

      const converted = validateConvertedTitles(parseJsonArray(responseText), chunk);
      titles.push(...converted);
      failedCount += chunk.length - converted.length;

      logs.push(
        createLlmLog({
          feedId,
          status: "success",
          itemCount: chunk.length,
          promptChars: prompt.length,
          responseChars: responseText.length,
          usageMetadata: response.usageMetadata,
          errorMessage: null,
          startedAt,
          finishedAt: new Date().toISOString()
        })
      );
    } catch (error) {
      failedCount += chunk.length;
      logs.push(
        createLlmLog({
          feedId,
          status: "error",
          itemCount: chunk.length,
          promptChars: prompt.length,
          responseChars: responseText.length,
          usageMetadata: undefined,
          errorMessage: error instanceof Error ? error.message : String(error),
          startedAt,
          finishedAt: new Date().toISOString()
        })
      );
    }
  }

  return {
    titles,
    failedCount,
    skippedCount: 0,
    logs
  };
}

function parseJsonArray(responseText: string): GeminiTitleResponse {
  const trimmed = responseText.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(withoutFence) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("Gemini title response is not an array");
  }

  return parsed as GeminiTitleResponse;
}

function validateConvertedTitles(parsed: GeminiTitleResponse, sourceItems: UnconvertedFeedItem[]): VipTitleWrite[] {
  const sourceIds = new Set(sourceItems.map((item) => item.id));
  const seenIds = new Set<string>();
  const titles: VipTitleWrite[] = [];

  for (const item of parsed) {
    if (!sourceIds.has(item.feedItemId) || seenIds.has(item.feedItemId)) {
      continue;
    }

    const title = normalizeVipTitle(item.vipTitle);
    if (!title) {
      continue;
    }

    titles.push({
      feedItemId: item.feedItemId,
      title
    });
    seenIds.add(item.feedItemId);
  }

  return titles;
}

function normalizeVipTitle(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function createLlmLog(params: {
  feedId: string;
  status: "success" | "error";
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
    purpose: "title_transform",
    model: appInfo.model,
    promptHash: vipTitlePromptHash,
    status: params.status,
    requestCount: 1,
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

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
