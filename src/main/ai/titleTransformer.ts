import type { LlmRequestLogWrite, UnconvertedFeedItem, VipTitleWrite } from "../db/repository.js";
import { buildVipTitlePrompt, vipTitlePromptHash } from "../prompts/vipTitlePrompt.js";
import { getActiveModel } from "../settings/settingsService.js";
import { VIP_TITLE_SYSTEM_INSTRUCTION } from "./promptParts.js";
import { createLogId, generateJson, resolveApiKey } from "./genaiClient.js";
import { vipTitleArraySchema } from "./schemas.js";

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

  const modelToUse = getActiveModel();

  if (!resolveApiKey()) {
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
          model: modelToUse,
          promptHash: vipTitlePromptHash,
          status: "skipped",
          requestCount: 0,
          itemCount: items.length,
          promptChars: 0,
          responseChars: 0,
          promptTokenCount: null,
          candidatesTokenCount: null,
          totalTokenCount: null,
          cachedContentTokenCount: null,
          errorMessage: "GEMINI_API_KEY or GOOGLE_API_KEY is not set",
          startedAt: now,
          finishedAt: now
        }
      ]
    };
  }

  const titles: VipTitleWrite[] = [];
  const logs: LlmRequestLogWrite[] = [];
  let failedCount = 0;

  for (const chunk of chunkItems(items, titleBatchSize)) {
    const startedAt = new Date().toISOString();
    const prompt = buildVipTitlePrompt(feedTitle, chunk);

    const result = await generateJson<GeminiTitleResponse>({
      model: modelToUse,
      purpose: "title_transform",
      systemInstruction: VIP_TITLE_SYSTEM_INSTRUCTION,
      contents: prompt,
      responseSchema: vipTitleArraySchema,
      timeoutMs: 30000,
      parse: (text) => {
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) throw new Error("Gemini title response is not an array");
        return parsed as GeminiTitleResponse;
      }
    });

    const finishedAt = new Date().toISOString();

    if (result.value) {
      const converted = validateConvertedTitles(result.value, chunk);
      titles.push(...converted);
      failedCount += chunk.length - converted.length;
    } else {
      failedCount += chunk.length;
    }

    logs.push({
      id: createLogId("llm", feedId, finishedAt),
      feedId,
      purpose: "title_transform",
      model: modelToUse,
      promptHash: vipTitlePromptHash,
      status: result.errorMessage ? "error" : "success",
      requestCount: 1,
      itemCount: chunk.length,
      promptChars: result.promptChars,
      responseChars: result.responseText.length,
      promptTokenCount: result.usageMetadata?.promptTokenCount ?? null,
      candidatesTokenCount: result.usageMetadata?.candidatesTokenCount ?? null,
      totalTokenCount: result.usageMetadata?.totalTokenCount ?? null,
      cachedContentTokenCount: result.usageMetadata?.cachedContentTokenCount ?? null,
      errorMessage: result.errorMessage,
      startedAt,
      finishedAt
    });
  }

  return {
    titles,
    failedCount,
    skippedCount: 0,
    logs
  };
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

function chunkItems<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}
