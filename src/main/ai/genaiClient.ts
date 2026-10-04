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

const maxConcurrentGeminiRequests = 5;
const maxQueuedGeminiRequests = 50;
let activeGeminiRequests = 0;
const geminiRequestWaiters: Array<() => void> = [];

export type LlmPurpose =
  | "title_transform"
  | "thread_response"
  | "thread_reply"
  | "article_summary";

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
  /** 並列枠の待機期限。省略時は30000ms。 */
  queueTimeoutMs?: number;
  signal?: AbortSignal;
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
    const response = await generateWithRequestSlot(
      generateContent, {
        model: request.model,
        contents: request.contents,
        config: {
          responseMimeType: "application/json",
          ...(request.systemInstruction
            ? { systemInstruction: request.systemInstruction }
            : {}),
          ...(request.responseSchema ? { responseSchema: request.responseSchema } : {})
        }
      },
      timeoutMs,
      request.purpose,
      request.signal,
      request.queueTimeoutMs
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
  /** 並列枠の待機期限。省略時は30000ms。 */
  queueTimeoutMs?: number;
  signal?: AbortSignal;
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
    const response = await generateWithRequestSlot(
      generateContent, {
        model: params.model,
        contents: params.contents,
        config: params.systemInstruction
          ? { systemInstruction: params.systemInstruction }
          : undefined
      },
      timeoutMs,
      params.purpose,
      params.signal,
      params.queueTimeoutMs
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

async function acquireGeminiRequestSlot(signal: AbortSignal | undefined, queueTimeoutMs: number): Promise<() => void> {
  if (signal?.aborted) throw cancellationError();
  if (activeGeminiRequests < maxConcurrentGeminiRequests) {
    activeGeminiRequests += 1;
  } else {
    if (geminiRequestWaiters.length >= maxQueuedGeminiRequests) {
      throw new Error("Gemini API の待機件数が上限に達しました。後でもう一度試してください。");
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };
      const start = () => { cleanup(); resolve(); };
      const cancel = (error: Error) => {
        const index = geminiRequestWaiters.indexOf(start);
        if (index >= 0) geminiRequestWaiters.splice(index, 1);
        cleanup();
        reject(error);
      };
      const onAbort = () => cancel(cancellationError());
      const timer = setTimeout(() => cancel(new Error("Gemini API の待機がタイムアウトしました。")), queueTimeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      geminiRequestWaiters.push(start);
    });
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const nextWaiter = geminiRequestWaiters.shift();
    if (nextWaiter) {
      nextWaiter();
    } else {
      activeGeminiRequests -= 1;
    }
  };
}

function cancellationError(): Error {
  return new Error("Gemini API 呼び出しをキャンセルしました。");
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

async function generateWithRequestSlot(
  generateContent: GenaiTransport["generateContent"],
  params: GenerateContentParameters,
  timeoutMs: number,
  purpose: LlmPurpose,
  signal?: AbortSignal,
  queueTimeoutMs = 30_000
): ReturnType<GenaiTransport["generateContent"]> {
  for (const duration of [timeoutMs, queueTimeoutMs]) {
    if (!Number.isFinite(duration) || duration <= 0 || duration > 2_147_483_647) {
      throw new Error("Gemini API のタイムアウト設定が不正です。");
    }
  }
  const release = await acquireGeminiRequestSlot(signal, queueTimeoutMs);
  // The caller may cancel while a queued slot is being handed over.
  if (signal?.aborted) {
    release();
    throw cancellationError();
  }
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    const cancel = (error: Error) => {
      // Reject first so the caller gets the useful timeout/cancellation reason,
      // even if the transport immediately rejects with a generic AbortError.
      reject(error);
      controller.abort(error);
    };
    onAbort = () => cancel(cancellationError());
    signal?.addEventListener("abort", onAbort, { once: true });
    timeout = setTimeout(() => cancel(new Error(
      `Gemini API 呼び出しがタイムアウトしました (${timeoutMs / 1000}秒) [${purpose}]`
    )), timeoutMs);
  });
  const operation = Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return generateContent({
      ...params,
      config: { ...params.config, abortSignal: controller.signal }
    });
  });
  // A timeout ends the caller's wait, not ownership of the slot. A transport
  // that ignores abort must finish before another request can use this slot.
  void operation.then(release, release);
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    if (timeout) clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
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
