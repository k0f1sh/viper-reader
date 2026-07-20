import crypto from "node:crypto";
import type { ThreadDetail, ThreadPost } from "../../shared/types.js";
import type { LlmRequestLogWrite } from "../db/repository.js";
import { buildVipExpertExplanationPrompt } from "../prompts/vipExpertExplanationPrompt.js";
import { VIP_EXPERT_SYSTEM_INSTRUCTION } from "./promptParts.js";
import { createLogId, generateJson, missingApiKeyMessage } from "./genaiClient.js";
import { expertThreadPostArraySchema } from "./schemas.js";

export const expertExplanationModel = "gemini-3.5-flash";
const maxBodySourceChars = 12000;

export async function generateExpertExplanation(
  thread: ThreadDetail,
  scrapedBody: string | null,
  promptHash: string
): Promise<{ posts: ThreadPost[]; log: LlmRequestLogWrite }> {
  const startedAt = new Date().toISOString();
  const bodySource = scrapedBody && scrapedBody.length > maxBodySourceChars
    ? `${scrapedBody.slice(0, maxBodySourceChars)}\n\n[本文は先頭${maxBodySourceChars}文字まで。以降は断言しないこと。]`
    : scrapedBody;
  const prompt = buildVipExpertExplanationPrompt({
    vipTitle: thread.vipTitle,
    originalTitle: thread.originalTitle,
    url: thread.url,
    rssBody: thread.posts[0]?.body ?? "",
    scrapedBody: bodySource,
    publishedAt: thread.publishedAt
  });
  const result = await generateJson<ThreadPost[]>({
    model: expertExplanationModel,
    purpose: "expert_explanation",
    systemInstruction: VIP_EXPERT_SYSTEM_INSTRUCTION,
    contents: prompt,
    responseSchema: expertThreadPostArraySchema,
    timeoutMs: 90000,
    parse: (text) => validateExpertPost(JSON.parse(text) as unknown)
  });
  const posts = result.value ?? [];
  const finishedAt = new Date().toISOString();

  const status = result.errorMessage === missingApiKeyMessage
    ? "skipped"
    : result.errorMessage
      ? "error"
      : "success";

  return {
    posts,
    log: {
      id: createLogId("llm", thread.feedId, finishedAt),
      feedId: thread.feedId,
      purpose: "expert_explanation",
      model: expertExplanationModel,
      promptHash,
      status,
      requestCount: status === "skipped" ? 0 : 1,
      itemCount: posts.length,
      promptChars: result.promptChars,
      responseChars: result.responseText.length,
      promptTokenCount: result.usageMetadata?.promptTokenCount ?? null,
      candidatesTokenCount: result.usageMetadata?.candidatesTokenCount ?? null,
      totalTokenCount: result.usageMetadata?.totalTokenCount ?? null,
      cachedContentTokenCount: result.usageMetadata?.cachedContentTokenCount ?? null,
      errorMessage: result.errorMessage,
      startedAt,
      finishedAt
    }
  };
}

function validateExpertPost(value: unknown): ThreadPost[] {
  if (!Array.isArray(value) || typeof value[0] !== "object" || value[0] === null) {
    return [];
  }
  const item = value[0] as Record<string, unknown>;
  const body = typeof item.body === "string" ? normalizeExpertBody(item.body).slice(0, 6000) : "";
  if (!body) return [];

  const rawId = typeof item.id === "string" ? item.id.replace(/^ID:/i, "").trim() : "";
  return [{
    no: 2,
    name: typeof item.name === "string" ? item.name.slice(0, 80) : "以下、名無しにかわりましてVIPがお送りします",
    mail: typeof item.mail === "string" ? item.mail.slice(0, 20) : "sage",
    date: typeof item.date === "string" ? item.date.slice(0, 40) : "2010/01/01(金) 00:00:00.00",
    id: /^[A-Za-z0-9]{8}$/.test(rawId) ? rawId : crypto.randomBytes(4).toString("hex"),
    body
  }];
}

function normalizeExpertBody(body: string): string {
  const trimmed = body.trim();
  return trimmed.includes("\n") ? trimmed : trimmed.replace(/\\n/g, "\n");
}
