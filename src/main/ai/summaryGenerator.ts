import { GoogleGenAI } from "@google/genai";
import type { LlmRequestLogWrite } from "../db/repository.js";
import { getActiveModel } from "../settings/settingsService.js";
import crypto from "node:crypto";

type UsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export type ArticleSummaryGenerationResult = {
  summary: string | null;
  log: LlmRequestLogWrite | null;
};

/**
 * 指定された記事本文を、技術的な要点を維持したまま300文字程度でシンプルに要約します。
 */
export async function generateArticleSummary(
  feedItemId: string,
  feedId: string,
  bodyText: string
): Promise<ArticleSummaryGenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const startedAt = new Date().toISOString();
  const prompt = `以下の文章を、技術的な要点を残したまま、300文字程度でシンプルに要約してください。余計な挨拶や前置きは省き、要約内容のみを出力してください。\n\n${bodyText}`;
  const promptHash = crypto.createHash("sha1").update(prompt).digest("hex").slice(0, 16);

  const modelToUse = getActiveModel();
  if (!apiKey) {
    const finishedAt = new Date().toISOString();
    return {
      summary: null,
      log: createLlmLog({
        feedId,
        model: modelToUse,
        promptHash,
        status: "skipped",
        promptChars: prompt.length,
        responseChars: 0,
        usageMetadata: undefined,
        errorMessage: "GEMINI_API_KEY or GOOGLE_API_KEY is not set",
        startedAt,
        finishedAt
      })
    };
  }

  console.log(`[LLM Request Start] Model: ${modelToUse} | Purpose: article_summary`);

  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: modelToUse, // dynamically chosen model
      contents: prompt
    });

    const summary = response.text?.trim() ?? "";
    const finishedAt = new Date().toISOString();

    return {
      summary,
      log: createLlmLog({
        feedId,
        model: modelToUse,
        promptHash,
        status: "success",
        promptChars: prompt.length,
        responseChars: summary.length,
        usageMetadata: response.usageMetadata,
        errorMessage: null,
        startedAt,
        finishedAt
      })
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const errMsg = error instanceof Error ? error.message : String(error);

    return {
      summary: null,
      log: createLlmLog({
        feedId,
        model: modelToUse,
        promptHash,
        status: "error",
        promptChars: prompt.length,
        responseChars: 0,
        usageMetadata: undefined,
        errorMessage: errMsg,
        startedAt,
        finishedAt
      })
    };
  }
}

function createLlmLog(params: {
  feedId: string;
  model: string;
  promptHash: string;
  status: "success" | "error" | "skipped";
  promptChars: number;
  responseChars: number;
  usageMetadata: UsageMetadata | undefined;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
}): LlmRequestLogWrite {
  return {
    id: `llm:${crypto.randomUUID().slice(0, 8)}`,
    feedId: params.feedId,
    purpose: "article_summary",
    model: params.model,
    promptHash: params.promptHash,
    status: params.status,
    requestCount: params.status === "skipped" ? 0 : 1,
    itemCount: 1,
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
