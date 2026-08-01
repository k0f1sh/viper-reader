import type { DatabaseSync } from "node:sqlite";
import { seedFeeds } from "../../shared/seedData.js";
import { getDatabase } from "./database.js";

export function initializeRepository(seedDefaultFeeds = true): void {
  const db = getDatabase();
  if (seedDefaultFeeds) seedDatabase(db);
}

export {
  addFeedSource,
  deleteFeedSource,
  getFeedSource,
  listFeeds,
  markAllFeedsRead,
  markFeedRead,
  reorderFeedSources,
  updateFeedTitleGenerationSetting
} from "./feedRepository.js";
export {
  clearFeedResidentPrompt,
  ensureFeedResidents,
  getActiveResidentPromptVersion,
  getFeedResidentPrompt,
  getPromptOptimizationEvidence,
  listResidentPromptVersions,
  reviewResidentPromptVersion,
  rollbackResidentPromptVersion,
  saveFeedResidentPrompt,
  saveReplyFeedback,
  saveResidentPromptProposal
} from "./residentPromptRepository.js";
export type { FeedResident } from "./residentPromptRepository.js";
export {
  getArticleBody,
  getArticleSummary,
  saveArticleBody,
  saveArticleSummary
} from "./articleRepository.js";
export {
  finishThreadGenerationAttempt,
  listThreadGenerationAttempts,
  markThreadGenerationReviewed,
  setThreadGenerationState,
  startThreadGenerationAttempt
} from "./threadGenerationRepository.js";
export {
  listReplyGenerationRuns,
  markLatestReplyRunContinued,
  postUserMessage,
  recordReplyGenerationRun,
  saveGeneratedThreadPosts,
  saveThreadResponsePosts
} from "./threadPostRepository.js";
export type { ThreadResponseWrite } from "./threadPostRepository.js";
export {
  countAllUnreadArticles,
  markThreadRead,
  setThreadFavorite,
  setThreadRead
} from "./threadStateRepository.js";
export {
  getStatistics,
  recordArticleFetchLog,
  recordLlmRequestLog,
  recordRssRefreshRun
} from "./statisticsRepository.js";
export type { ArticleFetchLogWrite } from "./statisticsRepository.js";
export type { LlmRequestLogWrite, RssRefreshRunWrite } from "./statisticsRepository.js";
export {
  getFeedItemForTitleGeneration,
  listFeedItemsForInitialCaches,
  listTitleGenerationAttempts,
  listUnconvertedFeedItems,
  recordTitleGenerationAttempts,
  replaceThreadTitle,
  saveRawThreadTitleFallbacks,
  saveRssThreadSummaries,
  saveThreadTitles,
  upsertFeedItems
} from "./feedItemRepository.js";
export type {
  FeedItemInitialCacheSource,
  FeedItemTitleGenerationSource,
  ThreadTitleWrite,
  UnconvertedFeedItem
} from "./feedItemRepository.js";
export {
  getReadingQueueSummary,
  getThread,
  listFavoriteThreads,
  listGeneratedQueue,
  listThreads
} from "./threadRepository.js";

function seedDatabase(db: DatabaseSync): void {
  const now = new Date().toISOString();

  const insertFeed = db.prepare(
    `
    INSERT INTO feed_sources (id, title, url, created_at, updated_at, last_fetched_at, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      updated_at = excluded.updated_at
    `
  );

  db.exec("BEGIN");
  try {
    for (const [index, feed] of seedFeeds.entries()) {
      insertFeed.run(feed.id, feed.title, feed.url, now, now, feed.lastFetchedAt, index);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
