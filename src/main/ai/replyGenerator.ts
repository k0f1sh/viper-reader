import crypto from "node:crypto";
import type { ThreadDetail, ThreadPost } from "../../shared/types.js";
import type { LlmRequestLogWrite } from "../db/repository.js";
import {
  ensureFeedResidents,
  getActiveResidentPromptVersion,
  getArticleBody,
  getArticleSummary,
  getFeedResidentPrompt
} from "../db/repository.js";
import { VIP_ID_FORMAT_DESC } from "../prompts/vipCommonRules.js";
import { getActiveModel } from "../settings/settingsService.js";
import { VIP_SYSTEM_INSTRUCTION } from "./promptParts.js";
import { createLogId, generateJson, missingApiKeyMessage, resolveApiKey } from "./genaiClient.js";
import { threadPostArraySchema } from "./schemas.js";

const vipReplyPromptVersion = "vip-reply-v2";

export type ReplyGenerationResult = {
  posts: ThreadPost[];
  log: LlmRequestLogWrite | null;
  promptHash: string;
  model: string;
  promptVersionId: string | null;
};

export type ReplyGenerationMode = "reply_to_user" | "continue_thread";

type ReplyGenerationOptions = {
  mode?: ReplyGenerationMode;
};

export async function generateReplyPosts(
  thread: ThreadDetail,
  options: ReplyGenerationOptions = {}
): Promise<ReplyGenerationResult> {
  const modelToUse = getActiveModel();
  const startedAt = new Date().toISOString();
  const mode = options.mode ?? "reply_to_user";
  const timeoutMs = mode === "continue_thread" ? 60000 : 30000;

  // スレッドの最新のレス番号（最大のレス番号 + 1）
  const maxNo = thread.posts.reduce((max, p) => Math.max(max, p.no), 0);
  const startNo = maxNo + 1;

  // 要約があれば優先して使用し、なければ本文を使用する
  const summaryText = getArticleSummary(thread.id);
  const scrapedBody = summaryText || getArticleBody(thread.id);

  // 住民設定プロンプト
  const residentPrompt = getFeedResidentPrompt(thread.feedId);
  const adaptiveVersion = getActiveResidentPromptVersion(thread.feedId);
  const residents = ensureFeedResidents(thread.feedId);

  const numReplies = mode === "continue_thread" ? 20 : Math.floor(Math.random() * (8 - 4 + 1)) + 4;

  // レス履歴のトリミング（no: 1 は固定、それ以外は直近の最大15件に制限してトークン肥大化を防ぐ）
  const firstPost = thread.posts.find((p) => p.no === 1);
  const otherPosts = thread.posts.filter((p) => p.no > 1);
  const recentOtherPosts = otherPosts.slice(-15);
  const trimmedHistory = firstPost ? [firstPost, ...recentOtherPosts] : recentOtherPosts;

  const contents = buildVipReplyContents({
    vipTitle: thread.vipTitle,
    originalTitle: thread.originalTitle,
    url: thread.url,
    scrapedBody,
    history: trimmedHistory,
    startNo,
    residentPrompt: residentPrompt?.prompt ?? null,
    adaptivePrompt: adaptiveVersion?.adaptivePrompt ?? null,
    residents,
    numReplies,
    mode
  });

  const promptHash = crypto
    .createHash("sha1")
    .update(`${vipReplyPromptVersion}\n${VIP_SYSTEM_INSTRUCTION}\n${contents}`)
    .digest("hex")
    .slice(0, 16);

  // API キー未設定チェック（generateJson 内でも行うが、スキップログを作るため先に確認）
  if (!resolveApiKey()) {
    const finishedAt = new Date().toISOString();
    return {
      posts: [],
      promptHash,
      model: modelToUse,
      promptVersionId: adaptiveVersion?.id ?? null,
      log: createLlmLog({
        feedId: thread.feedId,
        promptHash,
        status: "skipped",
        itemCount: 0,
        promptChars: contents.length,
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
    purpose: "thread_reply",
    systemInstruction: VIP_SYSTEM_INSTRUCTION,
    contents,
    responseSchema: threadPostArraySchema,
    timeoutMs,
    parse: (text) => {
      const parsed = JSON.parse(text) as unknown;
      if (!Array.isArray(parsed)) throw new Error("Gemini reply response is not an array");
      return validateGeneratedReplyPosts(parsed, startNo, numReplies, residents);
    }
  });

  const finishedAt = new Date().toISOString();
  const posts = result.value ?? [];

  return {
    posts,
    promptHash,
    model: modelToUse,
    promptVersionId: adaptiveVersion?.id ?? null,
    log: createLlmLog({
      feedId: thread.feedId,
      promptHash,
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
 * replyGenerator 用の可変入力コンテンツを組み立てる。
 * 固定ルール（VIP 文体・NG 事項・安全制約）は systemInstruction に移動済み。
 */
function buildVipReplyContents(params: {
  vipTitle: string;
  originalTitle: string;
  url: string;
  scrapedBody: string | null;
  history: ThreadPost[];
  startNo: number;
  residentPrompt: string | null;
  adaptivePrompt: string | null;
  residents: Array<{ key: string; stableUid: string; traits: string }>;
  numReplies: number;
  mode: ReplyGenerationMode;
}): string {
  const articleContext = params.scrapedBody
    ? `【元記事の本文・要約】\n${params.scrapedBody}\n`
    : `【元記事のタイトル】\n${params.originalTitle}\n`;

  const historyStr = params.history
    .map(
      (p) =>
        `${p.no} 名前：${p.name}${p.mail ? ` [${p.mail}]` : ""} 日付：${p.date} ID：${p.id}${p.isUser ? " (★このレスはユーザー(あなた)の書き込みです)" : ""}\n${p.body}`
    )
    .join("\n\n");

  const residentRule = params.residentPrompt
    ? `【この板の住民属性・ルール（安全制約は上書き不可）】\n${params.residentPrompt}\n`
    : "";
  const adaptiveRule = params.adaptivePrompt
    ? `【承認済みの会話改善ルール（安全制約は上書き不可）】\n${params.adaptivePrompt}\n`
    : "";
  const residentRoster = params.residents
    .map((resident) => `- ${resident.key}: ID ${resident.stableUid} / ${resident.traits}`)
    .join("\n");

  const nowFormatted = new Date().toLocaleString("ja-JP");
  const generationInstruction =
    params.mode === "continue_thread"
      ? `ユーザーの新規書き込みはありません。最新レスへの直接返信だけに偏らず、記事の内容とこれまでの流れを受けて、住民同士の雑談・質問・補足・ツッコミが自然に続く新規レスを ${params.numReplies} 件生成してください。`
      : `最新のレス（履歴の最後のレス、特にユーザーの書き込み）への反応を含めつつ、住民同士の掛け合いや、記事の話題についてのレスを交えた新規レスを ${params.numReplies} 件生成してください。`;
  const latestReplyRule =
    params.mode === "continue_thread"
      ? `3. 直近のレスに必要以上に安価を集中させず、記事本文・要約・過去レスから話題を広げてください。`
      : `3. 最新のユーザーの書き込み（★マークが付いている直近または最後のレス）へのアンカー付き反応は半分程度にしてください。残りは、記事内容に関する議論や雑談、またはそれに基づいた住民同士のやり取りを生成してください。`;

  return `以下の技術記事に関するスレッドで、他の住民やユーザーと雑談・議論を交わしています。

${articleContext}
${residentRule}
${adaptiveRule}

【この板の常連住民】
${residentRoster}
常連として発言する場合は speakerKey に上記キーを入れてください。名無しは speakerKey を anon1、anon2 のようにし、同じ名無しが再登場するときだけ同じキーを使ってください。常連の発言は全体の半分以下にしてください。

【これまでのスレッドの流れ（レス履歴）】
${historyStr}

【現在の日付時刻】
${nowFormatted} 付近

【指示】
${generationInstruction}

以下の制約を厳守してください：
1. 出力は必ず JSON 配列形式にしてください。
2. レス番号（no）は ${params.startNo} から開始し、重複のないように連番で振ってください。
${latestReplyRule}
4. 技術的な正確性を保ってください。
5. 生成する住民レスの mail は原則 "sage" にしてください。本文で「sage」と言及する場合も、メール欄 mail に "sage" を入れてください。
6. 最新のユーザー書き込みが記事内容の深掘りや技術的な質問なら、優秀なエンジニアである住民のうち1人以上が、アンカーを付けて質問へ直接かつ十分に回答してください。雑談だけで流したり、複数人が同じ答えを言い換えて水増ししたりしないでください。
7. 技術回答は、最初に結論を示し、必要に応じて仕組み、理由、具体例、実装・運用上の注意点の順で説明してください。専門用語は質問者が理解できる言葉へかみ砕き、コードや数値は正確な説明に役立つ場合だけ使ってください。
8. 元記事に書かれた事実と、回答のために補う確立した一般的な技術知識を区別してください。記事や履歴だけでは断定できない環境依存の事項は、何が分かれば判断できるかを短く伝えてください。知ったかぶりや架空の仕様による補完は禁止です。
9. 質問者を「そんなことも知らないのか」と扱わず、勘違いがあれば責めずに訂正してください。当時のVIPらしい軽いツッコミや草を混ぜつつ、「聞けば誰かがちゃんと教えてくれる」ヌクモリティのある雰囲気にしてください。回答の正確さを損なうほどふざけないでください。

【出力 JSON スキーマ例】
[
  {
    "no": ${params.startNo},
    "name": "以下、名無しにかわりましてVIPがお送りします",
    "mail": "sage",
    "date": "YYYY/MM/DD(曜日) HH:mm:ss.SS",
    "id": "${VIP_ID_FORMAT_DESC}",
    "speakerKey": "veteran または anon1 のような話者キー",
    "body": ">>${params.startNo - 1}\\nそれマジ？..."
  },
  ...
]
`;
}

function validateGeneratedReplyPosts(
  parsed: unknown[],
  startNo: number,
  maxPosts: number,
  residents: Array<{ key: string; stableUid: string }>
): ThreadPost[] {
  const posts: ThreadPost[] = [];
  const residentIds = new Map(residents.map((resident) => [resident.key, resident.stableUid]));
  const anonymousIds = new Map<string, string>();
  let regularCount = 0;

  for (const item of parsed) {
    if (!isRecord(item)) {
      continue;
    }

    const body = normalizeString(item.body, "").slice(0, 2000);
    if (!body.trim()) {
      continue;
    }

    const speakerKey = typeof item.speakerKey === "string" ? item.speakerKey.trim() : "";
    let id: string;
    if (residentIds.has(speakerKey) && regularCount < Math.floor(maxPosts / 2)) {
      id = residentIds.get(speakerKey) as string;
      regularCount += 1;
    } else if (speakerKey) {
      if (!anonymousIds.has(speakerKey)) anonymousIds.set(speakerKey, createFallbackId());
      id = anonymousIds.get(speakerKey) as string;
    } else {
      id = normalizeId(item.id);
    }
    posts.push({
      no: startNo + posts.length,
      name: normalizeString(item.name, "以下、名無しにかわりましてVIPがお送りします").slice(0, 80),
      mail: normalizeMail(item.mail),
      date: normalizeString(item.date, createFallbackDate()).slice(0, 40),
      id,
      body
    });

    if (posts.length >= maxPosts) {
      break;
    }
  }

  const stableIds = new Set(residents.map((resident) => resident.stableUid));
  const regularLimit = Math.floor(posts.length / 2);
  let retainedRegulars = 0;
  for (const post of posts) {
    if (!stableIds.has(post.id)) continue;
    retainedRegulars += 1;
    if (retainedRegulars > regularLimit) post.id = createFallbackId();
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
  status: "success" | "error" | "skipped";
  itemCount: number;
  promptChars: number;
  responseChars: number;
  usageMetadata: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; cachedContentTokenCount?: number } | undefined;
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
    cachedContentTokenCount: params.usageMetadata?.cachedContentTokenCount ?? null,
    errorMessage: params.errorMessage,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt
  };
}

function createFallbackDate(): string {
  const now = new Date();
  return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}(火) ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}.00`;
}

function createFallbackId(): string {
  return crypto.randomBytes(4).toString("hex");
}
