import type { ThreadDetail } from "../../shared/types.js";
import { transformTitlesToBoardStyle } from "../ai/titleTransformer.js";
import {
  getFeedItemForTitleGeneration,
  getThread,
  recordLlmRequestLog,
  replaceThreadTitle
} from "../db/repository.js";
import { getFeedSource } from "../db/feedRepository.js";
import { buildThreadTitlePromptHash } from "../prompts/threadTitlePrompt.js";
import { getTitleGenerationModel } from "../settings/settingsService.js";

export async function regenerateThreadTitle(threadId: string): Promise<ThreadDetail | null> {
  const item = getFeedItemForTitleGeneration(threadId);
  if (!item) {
    throw new Error(`Thread not found: ${threadId}`);
  }

  const modelToUse = getTitleGenerationModel();
  const feed = getFeedSource(item.feedId);
  const result = await transformTitlesToBoardStyle(item.feedId, item.feedTitle, [
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

  replaceThreadTitle(
    nextTitle,
    modelToUse,
    buildThreadTitlePromptHash(feed?.generateTitleFromSummary ?? false)
  );
  return getThread(threadId);
}
