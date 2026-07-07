import type { LlmRequestLogWrite } from "../db/repository.js";
import { getActiveModel } from "../settings/settingsService.js";
import { SUMMARY_SYSTEM_INSTRUCTION } from "./promptParts.js";
import { createLogId, generateText, resolveApiKey } from "./genaiClient.js";
import crypto from "node:crypto";

/**
 * 記事本文のテキスト長上限。
 * これを超える場合は先頭から切り詰め、その旨をプロンプト内で明示する。
 */
const MAX_BODY_CHARS = 8000;

export type ArticleSummaryGenerationResult = {
  summary: string | null;
  log: LlmRequestLogWrite | null;
};

/**
 * 指定された記事本文を、技術的な要点を維持したまま300文字程度でシンプルに要約します。
 * 本文が MAX_BODY_CHARS を超える場合は先頭から切り詰めて渡します。
 */
export async function generateArticleSummary(
  feedItemId: string,
  feedId: string,
  bodyText: string
): Promise<ArticleSummaryGenerationResult> {
  const startedAt = new Date().toISOString();
  const modelToUse = getActiveModel();

  // 本文が長すぎる場合は切り詰める
  let truncationNote = "";
  let bodyToUse = bodyText;
  if (bodyText.length > MAX_BODY_CHARS) {
    bodyToUse = bodyText.slice(0, MAX_BODY_CHARS);
    truncationNote = `\n\n[※ 本文が長いため先頭 ${MAX_BODY_CHARS} 文字のみ渡しています。後半の内容は要約に含めないでください。]`;
  }

  const contents = `以下の文章を、技術的な要点を残したまま、300文字程度でシンプルに要約してください。余計な挨拶や前置きは省き、要約内容のみを出力してください。\n\n${bodyToUse}${truncationNote}`;
  const promptHash = crypto.createHash("sha1").update(contents).digest("hex").slice(0, 16);

  if (!resolveApiKey()) {
    const finishedAt = new Date().toISOString();
    return {
      summary: null,
      log: createLlmLog({
        feedId,
        model: modelToUse,
        promptHash,
        status: "skipped",
        promptChars: contents.length,
        responseChars: 0,
        usageMetadata: undefined,
        errorMessage: "GEMINI_API_KEY or GOOGLE_API_KEY is not set",
        startedAt,
        finishedAt
      })
    };
  }

  const result = await generateText({
    model: modelToUse,
    purpose: "article_summary",
    systemInstruction: SUMMARY_SYSTEM_INSTRUCTION,
    contents,
    timeoutMs: 30000
  });

  const finishedAt = new Date().toISOString();

  return {
    summary: result.text,
    log: createLlmLog({
      feedId,
      model: modelToUse,
      promptHash,
      status: result.errorMessage ? "error" : "success",
      promptChars: result.promptChars,
      responseChars: result.responseText.length,
      usageMetadata: result.usageMetadata,
      errorMessage: result.errorMessage,
      startedAt,
      finishedAt
    })
  };
}

function createLlmLog(params: {
  feedId: string;
  model: string;
  promptHash: string;
  status: "success" | "error" | "skipped";
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
    cachedContentTokenCount: params.usageMetadata?.cachedContentTokenCount ?? null,
    errorMessage: params.errorMessage,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt
  };
}
