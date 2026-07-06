import { GoogleGenAI } from "@google/genai";
import { appInfo } from "../../shared/appInfo.js";
import { recordLlmRequestLog } from "../db/repository.js";
import crypto from "node:crypto";

/**
 * 指定された記事本文を、技術的な要点を維持したまま300文字程度でシンプルに要約します。
 */
export async function generateArticleSummary(
  feedItemId: string,
  feedId: string,
  bodyText: string
): Promise<string | null> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return null;
  }

  const startedAt = new Date().toISOString();
  const prompt = `以下の文章を、技術的な要点を残したまま、300文字程度でシンプルに要約してください。余計な挨拶や前置きは省き、要約内容のみを出力してください。\n\n${bodyText}`;
  const promptHash = crypto.createHash("sha1").update(prompt).digest("hex").slice(0, 16);

  console.log(`[LLM Request Start] Model: ${appInfo.model} | Purpose: article_summary`);

  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: appInfo.model, // gemini-3.1-flash-lite
      contents: prompt
    });

    const summary = response.text?.trim() ?? "";
    const finishedAt = new Date().toISOString();

    recordLlmRequestLog({
      id: `llm:${crypto.randomUUID().slice(0, 8)}`,
      feedId,
      purpose: "article_summary",
      model: appInfo.model,
      promptHash,
      status: "success",
      requestCount: 1,
      itemCount: 1,
      promptChars: prompt.length,
      responseChars: summary.length,
      promptTokenCount: response.usageMetadata?.promptTokenCount ?? null,
      candidatesTokenCount: response.usageMetadata?.candidatesTokenCount ?? null,
      totalTokenCount: response.usageMetadata?.totalTokenCount ?? null,
      errorMessage: null,
      startedAt,
      finishedAt
    });

    return summary;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const errMsg = error instanceof Error ? error.message : String(error);

    recordLlmRequestLog({
      id: `llm:${crypto.randomUUID().slice(0, 8)}`,
      feedId,
      purpose: "article_summary",
      model: appInfo.model,
      promptHash,
      status: "error",
      requestCount: 1,
      itemCount: 1,
      promptChars: prompt.length,
      responseChars: 0,
      promptTokenCount: null,
      candidatesTokenCount: null,
      totalTokenCount: null,
      errorMessage: errMsg,
      startedAt,
      finishedAt
    });

    return null;
  }
}
