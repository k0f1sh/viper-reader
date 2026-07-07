import crypto from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import type { ThreadDetail, ThreadPost } from "../../shared/types.js";
import type { LlmRequestLogWrite } from "../db/repository.js";
import { getArticleBody, getArticleSummary, getFeedResidentPrompt } from "../db/repository.js";
import { VIP_ID_FORMAT_DESC, VIP_NG_RULES, VIP_STYLE_RULES } from "../prompts/vipCommonRules.js";
import { getActiveModel } from "../settings/settingsService.js";

export type ReplyGenerationResult = {
  posts: ThreadPost[];
  log: LlmRequestLogWrite | null;
};

type UsageMetadata = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export async function generateReplyPosts(
  thread: ThreadDetail
): Promise<ReplyGenerationResult> {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  const modelToUse = getActiveModel();
  const startedAt = new Date().toISOString();

  // スレッドの最新のレス番号（最大のレス番号 + 1）
  const maxNo = thread.posts.reduce((max, p) => Math.max(max, p.no), 0);
  const startNo = maxNo + 1;

  // 要約があれば優先して使用し、なければ本文を使用する
  const summaryText = getArticleSummary(thread.id);
  const scrapedBody = summaryText || getArticleBody(thread.id);

  // 住民設定プロンプト
  const residentPrompt = getFeedResidentPrompt(thread.feedId);

  // 2〜5のレス数をランダムに選択
  const numReplies = Math.floor(Math.random() * (5 - 2 + 1)) + 2;

  // レス履歴のトリミング（no: 1 は固定、それ以外は直近の最大15件に制限してトークン肥大化を防ぐ）
  const firstPost = thread.posts.find((p) => p.no === 1);
  const otherPosts = thread.posts.filter((p) => p.no > 1);
  const recentOtherPosts = otherPosts.slice(-15);
  const trimmedHistory = firstPost ? [firstPost, ...recentOtherPosts] : recentOtherPosts;

  const prompt = buildVipReplyPrompt({
    vipTitle: thread.vipTitle,
    originalTitle: thread.originalTitle,
    url: thread.url,
    scrapedBody,
    history: trimmedHistory,
    startNo,
    residentPrompt: residentPrompt?.prompt ?? null,
    numReplies
  });

  const promptHash = crypto.createHash("sha1").update(prompt).digest("hex").slice(0, 16);

  if (!apiKey) {
    const finishedAt = new Date().toISOString();
    return {
      posts: [],
      log: createLlmLog({
        feedId: thread.feedId,
        promptHash,
        status: "skipped",
        itemCount: 0,
        promptChars: prompt.length,
        responseChars: 0,
        usageMetadata: undefined,
        errorMessage: "GEMINI_API_KEY or GOOGLE_API_KEY is not set",
        startedAt,
        finishedAt,
        model: modelToUse
      })
    };
  }

  const ai = new GoogleGenAI({ apiKey });
  let responseText = "";

  console.log(`[LLM Request Start] Model: ${modelToUse} | Purpose: thread_reply | Using Summary: ${!!summaryText}`);

  try {
    const response = await Promise.race([
      ai.models.generateContent({
        model: modelToUse,
        contents: prompt,
        config: {
          responseMimeType: "application/json"
        }
      }),
      new Promise<any>((_, reject) =>
        setTimeout(() => reject(new Error("Gemini API 呼び出しがタイムアウトしました (30秒)")), 30000)
      )
    ]);

    responseText = response.text ?? "";
    const parsed = parseJsonArray(responseText);
    const posts = validateGeneratedReplyPosts(parsed, startNo);
    const finishedAt = new Date().toISOString();

    const log = createLlmLog({
      feedId: thread.feedId,
      promptHash,
      status: "success",
      itemCount: posts.length,
      promptChars: prompt.length,
      responseChars: responseText.length,
      usageMetadata: response.usageMetadata,
      errorMessage: null,
      startedAt,
      finishedAt,
      model: modelToUse
    });

    return {
      posts,
      log
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const log = createLlmLog({
      feedId: thread.feedId,
      promptHash,
      status: "error",
      itemCount: 0,
      promptChars: prompt.length,
      responseChars: responseText.length,
      usageMetadata: undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
      startedAt,
      finishedAt,
      model: modelToUse
    });

    return {
      posts: [],
      log
    };
  }
}

function buildVipReplyPrompt(params: {
  vipTitle: string;
  originalTitle: string;
  url: string;
  scrapedBody: string | null;
  history: ThreadPost[];
  startNo: number;
  residentPrompt: string | null;
  numReplies: number;
}): string {
  const articleContext = params.scrapedBody
    ? `【元記事の本文】\n${params.scrapedBody}\n`
    : `【元記事のタイトル】\n${params.originalTitle}\n`;

  const historyStr = params.history
    .map(
      (p) =>
        `${p.no} 名前：${p.name}${p.mail ? ` [${p.mail}]` : ""} 日付：${p.date} ID：${p.id}${p.isUser ? " (★このレスはユーザー(あなた)の書き込みです)" : ""}\n${p.body}`
    )
    .join("\n\n");

  const residentRule = params.residentPrompt
    ? `【この板の住民属性・ルール】\n${params.residentPrompt}\n`
    : "";

  const nowFormatted = new Date().toLocaleString("ja-JP");

  return `あなたは 2010 年代前半の 2ch ニュー速 VIP 板のまとめブログに登場する住民（実況者）たちです。
以下の技術記事に関するスレッドで、他の住民やユーザーと雑談・議論を交わしています。

${articleContext}
${residentRule}

【これまでのスレッドの流れ（レス履歴）】
${historyStr}

【現在の日付時刻】
${nowFormatted} 付近

【指示】
最新のレス（履歴の最後のレス、特にユーザーの書き込み）に対して、アンカー（例: >>${params.startNo - 1}）を付けた返信や、住民同士の掛け合いを含む、新規のレスを ${params.numReplies} 件生成してください。

 以下の制約を厳守してください：
1. 出力は必ず JSON 配列形式にしてください。スキーマは後述します。
2. レス番号（no）は ${params.startNo} から開始し、重複のないように連番で振ってください。
3. 最新のユーザーの書き込み（★マークが付いている直近 of 最後のレス）に対して、安価（>>${params.startNo - 1} などのアンカー）を用いて、VIP風にツッコミや意見を返してください。
4. 技術的な正確性を保ってください。

${VIP_STYLE_RULES}

${VIP_NG_RULES}

【出力 JSON スキーマ】
[
  {
    "no": ${params.startNo},
    "name": "以下、名無しにかわりましてVIPがお送りします",
    "mail": "sage",
    "date": "YYYY/MM/DD(曜日) HH:mm:ss.SS", // 2ch風の日時。現在の日付時刻をベースにフォーマットした日付（曜日は日本語）を生成してください。秒以下は .XX のミリ秒形式です。数秒〜数十秒の書き込み間隔の差をつけてください。
    "id": "${VIP_ID_FORMAT_DESC}",
    "body": ">>${params.startNo - 1}\\nそれマジ？..."
  },
  ...
]
`;
}

function parseJsonArray(responseText: string): unknown[] {
  const trimmed = responseText.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const parsed = JSON.parse(withoutFence) as unknown;

  if (!Array.isArray(parsed)) {
    throw new Error("Gemini reply response is not an array");
  }

  return parsed;
}

function validateGeneratedReplyPosts(parsed: unknown[], startNo: number): ThreadPost[] {
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
      no: startNo + posts.length,
      name: normalizeString(item.name, "以下、名無しにかわりましてVIPがお送りします").slice(0, 80),
      mail: normalizeOptionalString(item.mail)?.slice(0, 20),
      date: normalizeString(item.date, createFallbackDate()).slice(0, 40),
      id: normalizeId(item.id),
      body
    });

    if (posts.length >= 10) {
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
  model: string;
}): LlmRequestLogWrite {
  return {
    id: createLogId("llm", params.feedId, params.finishedAt),
    feedId: params.feedId,
    purpose: "thread_reply",
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
  const now = new Date();
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}(火) ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.00`;
}

function createFallbackId(): string {
  return crypto.randomBytes(4).toString("hex");
}
