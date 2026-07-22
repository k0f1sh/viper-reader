import type { ThreadDetail } from "../../shared/types.js";
import { transformTitlesToVipStyle } from "../ai/titleTransformer.js";
import {
  getFeedItemForTitleGeneration,
  getFeedSource,
  getThread,
  recordLlmRequestLog,
  replaceVipTitle
} from "../db/repository.js";
import { vipTitlePromptHash } from "../prompts/vipTitlePrompt.js";
import { getTitleGenerationModel } from "../settings/settingsService.js";

export async function regenerateVipTitle(threadId: string): Promise<ThreadDetail | null> {
  const item = getFeedItemForTitleGeneration(threadId);
  if (!item) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  const modelToUse = getTitleGenerationModel();
  const feed = getFeedSource(item.feedId);
  const result = await transformTitlesToVipStyle(item.feedId, item.feedTitle, [
    {
      id: item.id,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt,
      rawSummary: item.rawSummary
    }
  ], feed?.generateTitleFromSummary ?? false);

  for (const log of result.logs) {
    recordLlmRequestLog(log);
  }

  const nextTitle = result.titles[0];
  if (!nextTitle) {
    throw new Error("スレタイ再生成に失敗しました。APIキーやログを確認してください。");
  }

  replaceVipTitle(nextTitle, modelToUse, vipTitlePromptHash);
  return getThread(threadId);
}
