/**
 * Gemini API 呼び出しの共通ラッパー。
 * - GoogleGenAI 初期化を一箇所に集約する。
 * - API キー未設定時の扱いを統一する。
 * - timeout、JSON parse、usageMetadata 取得を共通化する。
 */

import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import type { ContentUnion, GenerateContentParameters, SchemaUnion } from "@google/genai";
import { getGeminiApiKey } from "../settings/settingsService.js";

export type LlmPurpose =
  | "title_transform"
  | "thread_response"
  | "thread_reply"
  | "article_summary"
  | "prompt_optimization";

export type UsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
};

export type GenaiJsonRequest<T> = {
  model: string;
  purpose: LlmPurpose;
  systemInstruction?: string;
  contents: string | ContentUnion;
  responseSchema?: SchemaUnion;
  /** タイムアウトミリ秒。省略時は 30000ms */
  timeoutMs?: number;
  parse: (text: string) => T;
};

export type GenaiJsonResult<T> = {
  value: T | null;
  responseText: string;
  usageMetadata?: UsageMetadata;
  promptChars: number;
  errorMessage: string | null;
};

export type GenaiTransport = {
  apiKey: string;
  generateContent: (params: GenerateContentParameters) => Promise<{
    text?: string;
    usageMetadata?: UsageMetadata;
  }>;
};

export const missingApiKeyMessage =
  "Gemini API キーが設定されていません。アプリの「設定」から登録してください。";

/** API キーをローカル設定、環境変数の順に取得する。なければ null を返す。 */
export function resolveApiKey(): string | null {
  return getGeminiApiKey();
}

/**
 * JSON レスポンスを期待する Gemini API 呼び出しの共通関数。
 * API キー未設定時や timeout/parse エラー時も例外を投げず errorMessage で返す。
 */
export async function generateJson<T>(
  request: GenaiJsonRequest<T>,
  transport?: GenaiTransport
): Promise<GenaiJsonResult<T>> {
  const apiKey = transport?.apiKey ?? resolveApiKey();
  const contentsStr =
    typeof request.contents === "string" ? request.contents : JSON.stringify(request.contents);
  const promptChars = contentsStr.length;

  if (!apiKey) {
    return {
      value: null,
      responseText: "",
      promptChars,
      errorMessage: missingApiKeyMessage
    };
  }

  const ai = transport ? null : new GoogleGenAI({ apiKey });
  const generateContent = transport?.generateContent
    ?? ai!.models.generateContent.bind(ai!.models);
  const timeoutMs = request.timeoutMs ?? 30000;

  let responseText = "";

  console.log(
    `[LLM Request Start] Model: ${request.model} | Purpose: ${request.purpose}`
  );

  try {
    const response = await raceWithTimeout(
      generateContent({
        model: request.model,
        contents: request.contents,
        config: {
          responseMimeType: "application/json",
          ...(request.systemInstruction
            ? { systemInstruction: request.systemInstruction }
            : {}),
          ...(request.responseSchema ? { responseSchema: request.responseSchema } : {})
        }
      }),
      timeoutMs,
      request.purpose
    );

    responseText = response.text ?? "";
    const value = parseJsonResponse(responseText, request.parse);

    return {
      value,
      responseText,
      usageMetadata: response.usageMetadata as UsageMetadata | undefined,
      promptChars,
      errorMessage: value === null ? "JSON パースに失敗しました" : null
    };
  } catch (error) {
    return {
      value: null,
      responseText,
      promptChars,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * テキストレスポンス（JSON でない）を期待する Gemini API 呼び出しの共通関数。
 */
export async function generateText(params: {
  model: string;
  purpose: LlmPurpose;
  systemInstruction?: string;
  contents: string;
  timeoutMs?: number;
}, transport?: GenaiTransport): Promise<{
  text: string | null;
  responseText: string;
  usageMetadata?: UsageMetadata;
  promptChars: number;
  errorMessage: string | null;
}> {
  const apiKey = transport?.apiKey ?? resolveApiKey();
  const promptChars = params.contents.length;

  if (!apiKey) {
    return {
      text: null,
      responseText: "",
      promptChars,
      errorMessage: missingApiKeyMessage
    };
  }

  const ai = transport ? null : new GoogleGenAI({ apiKey });
  const generateContent = transport?.generateContent
    ?? ai!.models.generateContent.bind(ai!.models);
  const timeoutMs = params.timeoutMs ?? 30000;

  console.log(
    `[LLM Request Start] Model: ${params.model} | Purpose: ${params.purpose}`
  );

  let responseText = "";

  try {
    const response = await raceWithTimeout(
      generateContent({
        model: params.model,
        contents: params.contents,
        config: params.systemInstruction
          ? { systemInstruction: params.systemInstruction }
          : undefined
      }),
      timeoutMs,
      params.purpose
    );

    responseText = response.text ?? "";

    return {
      text: responseText.trim() || null,
      responseText,
      usageMetadata: response.usageMetadata as UsageMetadata | undefined,
      promptChars,
      errorMessage: null
    };
  } catch (error) {
    return {
      text: null,
      responseText,
      promptChars,
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * レスポンステキストの JSON 構文を確認してから parse 関数に渡す。
 * Markdown コードフェンスは除去する。
 * JSON 構文エラーと、parse 内の追加検証エラーを区別して呼び出し元へ返す。
 */
function parseJsonResponse<T>(responseText: string, parse: (text: string) => T): T {
  const trimmed = responseText.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    JSON.parse(withoutFence);
  } catch {
    throw new Error("JSON パースに失敗しました");
  }

  return parse(withoutFence);
}

async function raceWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  purpose: LlmPurpose
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(
            `Gemini API 呼び出しがタイムアウトしました (${timeoutMs / 1000}秒) [${purpose}]`
          )),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

/** 共通のログ ID 生成ユーティリティ */
export function createLogId(prefix: string, feedId: string | null, value: string): string {
  const hash = crypto
    .createHash("sha1")
    .update(`${prefix}:${feedId ?? ""}:${value}:${crypto.randomUUID()}`)
    .digest("hex")
    .slice(0, 20);
  return `${prefix}:${hash}`;
}
