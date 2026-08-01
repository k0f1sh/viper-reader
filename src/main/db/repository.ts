import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { seedFeeds } from "../../shared/seedData.js";
import type {
  ApiRequestSummary,
  ArticleFetchSummary,
  RefreshFeedResult,
  RssRefreshRunSummary,
  StatisticsSummary,
  ThreadDetail,
  TitleGenerationAttempt,
  ThreadListItem,
  ThreadListPage,
  ThreadPost,
  ReadingQueueSummary
} from "../../shared/types.js";
import {
  defaultResidentPromptHash,
  threadResponsePromptHash
} from "../prompts/threadResponsePrompt.js";
import { buildThreadTitlePromptHash } from "../prompts/threadTitlePrompt.js";
import { getActiveModel, getTitleGenerationModel } from "../settings/settingsService.js";
import { canonicalizeArticleUrl } from "../articles/canonicalUrl.js";
import {
  createFirstPostBody,
  createInitialPosts,
  rawTitlePromptHash,
  rssSummaryPromptHash
} from "../threads/initialThreadPosts.js";
import { getDatabase } from "./database.js";
import { listReplyGenerationRuns, saveGeneratedThreadPosts } from "./threadPostRepository.js";
import { countAllUnreadArticles, markThreadRead } from "./threadStateRepository.js";

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

type ThreadRow = {
  id: string;
  feed_id: string;
  original_title: string;
  url: string;
  thread_title: string;
  source: string;
  published_at: string | null;
  read_at: string | null;
  raw_summary: string | null;
  response_count: number;
  is_favorite: number;
  generation_status?: ThreadListItem["generationStatus"];
  title_generation_status?: "completed" | "failed" | "skipped" | null;
  posts_json?: string;
  response_posts_json?: string;
};

type RssStatsRow = {
  total_runs: number | null;
  success_runs: number | null;
  error_runs: number | null;
  fetched_count: number | null;
  inserted_count: number | null;
  updated_count: number | null;
  skipped_count: number | null;
  converted_count: number | null;
  conversion_failed_count: number | null;
  conversion_skipped_count: number | null;
  last_finished_at: string | null;
};

type ApiStatsRow = {
  total_logs: number | null;
  request_count: number | null;
  success_logs: number | null;
  error_logs: number | null;
  skipped_logs: number | null;
  item_count: number | null;
  prompt_chars: number | null;
  response_chars: number | null;
  prompt_token_count: number | null;
  candidates_token_count: number | null;
  total_token_count: number | null;
  last_finished_at: string | null;
};

type RssRunRow = {
  id: string;
  feed_id: string;
  feed_url: string;
  status: string;
  fetched_count: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  converted_count: number;
  conversion_failed_count: number;
  conversion_skipped_count: number;
  error_message: string | null;
  finished_at: string;
};

type ApiRequestRow = {
  id: string;
  feed_id: string | null;
  purpose: string;
  model: string;
  prompt_hash: string;
  status: string;
  request_count: number;
  item_count: number;
  prompt_chars: number;
  response_chars: number;
  prompt_token_count: number | null;
  candidates_token_count: number | null;
  total_token_count: number | null;
  cached_content_token_count: number | null;
  error_message: string | null;
  finished_at: string;
};

export type UnconvertedFeedItem = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  rawSummary: string | null;
};

export type FeedItemTitleGenerationSource = UnconvertedFeedItem & {
  feedId: string;
  feedTitle: string;
};

export type ThreadTitleWrite = {
  feedItemId: string;
  title: string;
};

export type RssRefreshRunWrite = Omit<RefreshFeedResult, "fetchedAt"> & {
  id: string;
  feedUrl: string;
  status: "success" | "error";
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
};

export type LlmRequestLogWrite = {
  id: string;
  feedId: string | null;
  purpose: string;
  model: string;
  promptHash: string;
  status: "success" | "error" | "skipped";
  requestCount: number;
  itemCount: number;
  promptChars: number;
  responseChars: number;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
  cachedContentTokenCount: number | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
};

export type FeedItemInitialCacheSource = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  rawSummary: string | null;
};

const legacySeedThreadIds = ["qiita-1", "qiita-2", "qiita-4", "zenn-1", "personal-1"];

export function initializeRepository(seedDefaultFeeds = true): void {
  const db = getDatabase();
  if (seedDefaultFeeds) seedDatabase(db);
}

export function upsertFeedItems(
  feedId: string,
  items: Array<{
    id: string;
    feedId: string;
    guid: string | null;
    title: string;
    url: string;
    publishedAt: string | null;
    rawSummary: string | null;
  }>
): RefreshFeedResult & { insertedItemIds: string[] } {
  const db = getDatabase();
  const fetchedAt = new Date().toISOString();
  let insertedCount = 0;
  const insertedItemIds: string[] = [];
  let updatedCount = 0;
  let skippedCount = 0;

  const existingStatement = db.prepare(
    "SELECT id, title, url, published_at, raw_summary FROM feed_items WHERE id = ? OR (feed_id = ? AND url = ?)"
  );
  const insertItem = db.prepare(
    `
    INSERT INTO feed_items (id, feed_id, guid, title, url, canonical_url, published_at, raw_summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );
  const updateItem = db.prepare(
    `
    UPDATE feed_items
    SET title = ?, url = ?, canonical_url = ?, published_at = ?, raw_summary = ?, updated_at = ?
    WHERE id = ?
    `
  );
  const deleteDerivedTitles = db.prepare("DELETE FROM thread_titles WHERE feed_item_id = ?");
  const deleteDerivedSummaries = db.prepare("DELETE FROM thread_summaries WHERE feed_item_id = ?");
  const deleteArticleBodies = db.prepare("DELETE FROM article_bodies WHERE feed_item_id = ?");
  const updateFeed = db.prepare("UPDATE feed_sources SET last_fetched_at = ?, updated_at = ? WHERE id = ?");

  db.exec("BEGIN");
  try {
    for (const item of items) {
      const canonicalUrl = canonicalizeArticleUrl(item.url);
      const existing = existingStatement.get(item.id, item.feedId, item.url) as
        | {
            id: string;
            title: string;
            url: string;
            published_at: string | null;
            raw_summary: string | null;
          }
        | undefined;
      const feedItemId = existing?.id ?? item.id;

      if (!existing) {
        insertItem.run(
          item.id,
          item.feedId,
          item.guid,
          item.title,
          item.url,
          canonicalUrl,
          item.publishedAt,
          item.rawSummary,
          fetchedAt,
          fetchedAt
        );
        insertedCount += 1;
        insertedItemIds.push(item.id);
      } else if (
        existing.title !== item.title ||
        existing.url !== item.url ||
        existing.published_at !== item.publishedAt ||
        existing.raw_summary !== item.rawSummary
      ) {
        deleteDerivedTitles.run(feedItemId);
        deleteDerivedSummaries.run(feedItemId);
        if (existing.url !== item.url) {
          deleteArticleBodies.run(feedItemId);
        }
        updateItem.run(item.title, item.url, canonicalUrl, item.publishedAt, item.rawSummary, fetchedAt, feedItemId);
        updatedCount += 1;
      } else {
        skippedCount += 1;
      }

    }

    updateFeed.run(fetchedAt, fetchedAt, feedId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    feedId,
    fetchedCount: items.length,
    insertedCount,
    updatedCount,
    skippedCount,
    convertedCount: 0,
    conversionFailedCount: 0,
    conversionSkippedCount: 0,
    fetchedAt,
    insertedItemIds
  };
}

export function listFeedItemsForInitialCaches(feedId: string): FeedItemInitialCacheSource[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT id, title, url, published_at, raw_summary
      FROM feed_items
      WHERE feed_id = ?
      ORDER BY COALESCE(published_at, created_at) DESC, created_at DESC, id DESC
      `
    )
    .all(feedId) as Array<{
      id: string;
      title: string;
      url: string;
      published_at: string | null;
      raw_summary: string | null;
    }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    publishedAt: row.published_at,
    rawSummary: row.raw_summary
  }));
}

export function saveRawThreadTitleFallbacks(items: FeedItemInitialCacheSource[], model: string): number {
  if (items.length === 0) {
    return 0;
  }

  const db = getDatabase();
  const generatedAt = new Date().toISOString();
  const insertTitle = db.prepare(
    `
    INSERT OR IGNORE INTO thread_titles (id, feed_item_id, model, prompt_hash, title, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  );
  let savedCount = 0;

  db.exec("BEGIN");
  try {
    for (const item of items) {
      const result = insertTitle.run(
        createThreadTitleId(item.id, model, rawTitlePromptHash),
        item.id,
        model,
        rawTitlePromptHash,
        item.title,
        generatedAt
      );
      savedCount += Number(result.changes);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return savedCount;
}

export function saveRssThreadSummaries(items: FeedItemInitialCacheSource[], model: string): number {
  if (items.length === 0) {
    return 0;
  }

  const db = getDatabase();
  const generatedAt = new Date().toISOString();
  const insertSummary = db.prepare(
    `
    INSERT OR IGNORE INTO thread_summaries
      (id, feed_item_id, model, prompt_hash, posts_json, response_count, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  );
  let savedCount = 0;

  db.exec("BEGIN");
  try {
    for (const item of items) {
      const posts = createInitialPosts(
        {
          title: item.title,
          url: item.url,
          rawSummary: item.rawSummary
        },
        item.publishedAt ?? generatedAt
      );
      const result = insertSummary.run(
        `thread-summary:${item.id}:rss`,
        item.id,
        model,
        rssSummaryPromptHash,
        JSON.stringify(posts),
        posts.length,
        generatedAt
      );
      savedCount += Number(result.changes);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return savedCount;
}

export function listUnconvertedFeedItems(
  feedId: string,
  model: string,
  promptHash: string
): UnconvertedFeedItem[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT fi.id, fi.title, fi.url, fi.published_at, fi.raw_summary
      FROM feed_items fi
      LEFT JOIN thread_titles vt
        ON vt.feed_item_id = fi.id
        AND vt.model = ?
        AND vt.prompt_hash = ?
      WHERE fi.feed_id = ?
        AND fi.read_at IS NULL
        AND vt.id IS NULL
      ORDER BY COALESCE(fi.published_at, fi.created_at) DESC, fi.created_at DESC, fi.id DESC
      `
    )
    .all(model, promptHash, feedId) as Array<{
      id: string;
      title: string;
      url: string;
      published_at: string | null;
      raw_summary: string | null;
    }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    publishedAt: row.published_at,
    rawSummary: row.raw_summary
  }));
}

export function getFeedItemForTitleGeneration(feedItemId: string): FeedItemTitleGenerationSource | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT
        fi.id,
        fi.feed_id,
        fi.title,
        fi.url,
        fi.published_at,
        fi.raw_summary,
        fs.title AS feed_title
      FROM feed_items fi
      INNER JOIN feed_sources fs ON fs.id = fi.feed_id
      WHERE fi.id = ?
      `
    )
    .get(feedItemId) as
    | {
        id: string;
        feed_id: string;
        title: string;
        url: string;
        published_at: string | null;
        raw_summary: string | null;
        feed_title: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    feedId: row.feed_id,
    feedTitle: row.feed_title,
    title: row.title,
    url: row.url,
    publishedAt: row.published_at,
    rawSummary: row.raw_summary
  };
}

export function saveThreadTitles(titles: ThreadTitleWrite[], model: string, promptHash: string): number {
  if (titles.length === 0) {
    return 0;
  }

  const db = getDatabase();
  const generatedAt = new Date().toISOString();
  const insertTitle = db.prepare(
    `
    INSERT OR IGNORE INTO thread_titles (id, feed_item_id, model, prompt_hash, title, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  );
  let savedCount = 0;

  db.exec("BEGIN");
  try {
    for (const title of titles) {
      const result = insertTitle.run(
        createThreadTitleId(title.feedItemId, model, promptHash),
        title.feedItemId,
        model,
        promptHash,
        title.title,
        generatedAt
      );
      savedCount += Number(result.changes);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return savedCount;
}

export function recordTitleGenerationAttempts(
  outcomes: Array<{
    feedItemId: string;
    status: "completed" | "failed" | "skipped";
    errorMessage: string | null;
  }>,
  model: string,
  promptHash: string
): void {
  if (outcomes.length === 0) return;
  const db = getDatabase();
  const attemptedAt = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO title_generation_attempts
      (id, feed_item_id, status, error_message, model, prompt_hash, attempted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.exec("BEGIN");
  try {
    for (const outcome of outcomes) {
      insert.run(
        `title-generation:${crypto.randomUUID()}`,
        outcome.feedItemId,
        outcome.status,
        outcome.errorMessage?.slice(0, 8_000) ?? null,
        model,
        promptHash,
        attemptedAt
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listTitleGenerationAttempts(threadId: string, limit = 5): TitleGenerationAttempt[] {
  const safeLimit = Math.min(20, Math.max(1, Math.floor(limit)));
  const rows = getDatabase().prepare(`
    SELECT id, feed_item_id, status, error_message, model, attempted_at
    FROM title_generation_attempts
    WHERE feed_item_id = ?
    ORDER BY attempted_at DESC, rowid DESC
    LIMIT ?
  `).all(threadId, safeLimit) as Array<{
    id: string;
    feed_item_id: string;
    status: TitleGenerationAttempt["status"];
    error_message: string | null;
    model: string;
    attempted_at: string;
  }>;
  return rows.map((row) => ({
    id: row.id,
    threadId: row.feed_item_id,
    status: row.status,
    errorMessage: row.error_message,
    model: row.model,
    attemptedAt: row.attempted_at
  }));
}

export function replaceThreadTitle(title: ThreadTitleWrite, model: string, promptHash: string): void {
  const db = getDatabase();
  const generatedAt = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO thread_titles (id, feed_item_id, model, prompt_hash, title, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(feed_item_id, model, prompt_hash) DO UPDATE SET
      title = excluded.title,
      generated_at = excluded.generated_at
    `
  ).run(
    createThreadTitleId(title.feedItemId, model, promptHash),
    title.feedItemId,
    model,
    promptHash,
    title.title,
    generatedAt
  );
}

function createThreadTitleId(feedItemId: string, model: string, promptHash: string): string {
  return `thread-title:${feedItemId}:${model}:${promptHash}`;
}

export function recordRssRefreshRun(run: RssRefreshRunWrite): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO rss_refresh_runs
      (
        id,
        feed_id,
        feed_url,
        status,
        fetched_count,
        inserted_count,
        updated_count,
        skipped_count,
        converted_count,
        conversion_failed_count,
        conversion_skipped_count,
        error_message,
        started_at,
        finished_at
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    run.id,
    run.feedId,
    run.feedUrl,
    run.status,
    run.fetchedCount,
    run.insertedCount,
    run.updatedCount,
    run.skippedCount,
    run.convertedCount,
    run.conversionFailedCount,
    run.conversionSkippedCount,
    run.errorMessage,
    run.startedAt,
    run.finishedAt
  );
}

export function recordLlmRequestLog(log: LlmRequestLogWrite): void {
  const cachedHit = log.cachedContentTokenCount ? ` | CachedTokens: ${log.cachedContentTokenCount}` : "";
  console.log(
    `[LLM Request] Model: ${log.model} | Purpose: ${log.purpose} | Status: ${log.status} | Prompt Chars: ${log.promptChars} | Response Chars: ${log.responseChars} | Tokens: ${log.totalTokenCount ?? "N/A"} (prompt: ${log.promptTokenCount ?? "N/A"}, candidates: ${log.candidatesTokenCount ?? "N/A"})${cachedHit}${log.errorMessage ? ` | Error: ${log.errorMessage}` : ""}`
  );
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO llm_request_logs
      (
        id,
        feed_id,
        purpose,
        model,
        prompt_hash,
        status,
        request_count,
        item_count,
        prompt_chars,
        response_chars,
        prompt_token_count,
        candidates_token_count,
        total_token_count,
        cached_content_token_count,
        error_message,
        started_at,
        finished_at
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    log.id,
    log.feedId,
    log.purpose,
    log.model,
    log.promptHash,
    log.status,
    log.requestCount,
    log.itemCount,
    log.promptChars,
    log.responseChars,
    log.promptTokenCount,
    log.candidatesTokenCount,
    log.totalTokenCount,
    log.cachedContentTokenCount ?? null,
    log.errorMessage,
    log.startedAt,
    log.finishedAt
  );
}

export type ArticleFetchLogWrite = {
  feedItemId: string;
  url: string;
  status: "success" | "error" | "skipped";
  robotsResult: "allowed" | "disallowed" | "fetch_error" | "fetch_timeout";
  elapsedMs: number;
  contentSize: number;
  errorMessage: string | null;
};

export function recordArticleFetchLog(log: ArticleFetchLogWrite): void {
  console.log(
    `[Scraper] URL: ${log.url} | Status: ${log.status} | robots.txt: ${log.robotsResult} | Size: ${log.contentSize} bytes | Time: ${log.elapsedMs}ms${log.errorMessage ? ` | Error: ${log.errorMessage}` : ""}`
  );
  const db = getDatabase();
  const fetchedAt = new Date().toISOString();
  const hash = crypto
    .createHash("sha1")
    .update(`fetch:${log.feedItemId}:${fetchedAt}:${crypto.randomUUID()}`)
    .digest("hex")
    .slice(0, 20);
  const id = `fetch:${hash}`;

  db.prepare(
    `
    INSERT INTO article_fetch_logs
      (id, feed_item_id, url, status, robots_result, elapsed_ms, content_size, error_message, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    log.feedItemId,
    log.url,
    log.status,
    log.robotsResult,
    log.elapsedMs,
    log.contentSize,
    log.errorMessage,
    fetchedAt
  );
}

export function getStatistics(): StatisticsSummary {
  const db = getDatabase();
  const rssRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total_runs,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_runs,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_runs,
        SUM(fetched_count) AS fetched_count,
        SUM(inserted_count) AS inserted_count,
        SUM(updated_count) AS updated_count,
        SUM(skipped_count) AS skipped_count,
        SUM(converted_count) AS converted_count,
        SUM(conversion_failed_count) AS conversion_failed_count,
        SUM(conversion_skipped_count) AS conversion_skipped_count,
        MAX(finished_at) AS last_finished_at
      FROM rss_refresh_runs
      `
    )
    .get() as RssStatsRow;
  const apiRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total_logs,
        SUM(request_count) AS request_count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_logs,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_logs,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_logs,
        SUM(item_count) AS item_count,
        SUM(prompt_chars) AS prompt_chars,
        SUM(response_chars) AS response_chars,
        SUM(prompt_token_count) AS prompt_token_count,
        SUM(candidates_token_count) AS candidates_token_count,
        SUM(total_token_count) AS total_token_count,
        MAX(finished_at) AS last_finished_at
      FROM llm_request_logs
      `
    )
    .get() as ApiStatsRow;
  const recentRssRows = db
    .prepare(
      `
      SELECT
        id,
        feed_id,
        feed_url,
        status,
        fetched_count,
        inserted_count,
        updated_count,
        skipped_count,
        converted_count,
        conversion_failed_count,
        conversion_skipped_count,
        error_message,
        finished_at
      FROM rss_refresh_runs
      ORDER BY finished_at DESC
      LIMIT 10
      `
    )
    .all() as RssRunRow[];
  const recentApiRows = db
    .prepare(
      `
      SELECT
        id,
        feed_id,
        purpose,
        model,
        prompt_hash,
        status,
        request_count,
        item_count,
        prompt_chars,
        response_chars,
        prompt_token_count,
        candidates_token_count,
        total_token_count,
        cached_content_token_count,
        error_message,
        finished_at
      FROM llm_request_logs
      ORDER BY finished_at DESC
      LIMIT 10
      `
    )
    .all() as ApiRequestRow[];

  const recentArticleFetchRows = db
    .prepare(
      `
      SELECT
        id,
        feed_item_id,
        url,
        status,
        robots_result,
        elapsed_ms,
        content_size,
        error_message,
        fetched_at
      FROM article_fetch_logs
      ORDER BY fetched_at DESC
      LIMIT 10
      `
    )
    .all() as ArticleFetchRow[];

  return {
    rss: {
      totalRuns: Number(rssRow.total_runs ?? 0),
      successRuns: Number(rssRow.success_runs ?? 0),
      errorRuns: Number(rssRow.error_runs ?? 0),
      fetchedCount: Number(rssRow.fetched_count ?? 0),
      insertedCount: Number(rssRow.inserted_count ?? 0),
      updatedCount: Number(rssRow.updated_count ?? 0),
      skippedCount: Number(rssRow.skipped_count ?? 0),
      convertedCount: Number(rssRow.converted_count ?? 0),
      conversionFailedCount: Number(rssRow.conversion_failed_count ?? 0),
      conversionSkippedCount: Number(rssRow.conversion_skipped_count ?? 0),
      lastFinishedAt: rssRow.last_finished_at
    },
    api: {
      totalLogs: Number(apiRow.total_logs ?? 0),
      requestCount: Number(apiRow.request_count ?? 0),
      successLogs: Number(apiRow.success_logs ?? 0),
      errorLogs: Number(apiRow.error_logs ?? 0),
      skippedLogs: Number(apiRow.skipped_logs ?? 0),
      itemCount: Number(apiRow.item_count ?? 0),
      promptChars: Number(apiRow.prompt_chars ?? 0),
      responseChars: Number(apiRow.response_chars ?? 0),
      promptTokenCount: Number(apiRow.prompt_token_count ?? 0),
      candidatesTokenCount: Number(apiRow.candidates_token_count ?? 0),
      totalTokenCount: Number(apiRow.total_token_count ?? 0),
      lastFinishedAt: apiRow.last_finished_at
    },
    recentRssRuns: recentRssRows.map(rowToRssRefreshRunSummary),
    recentApiRequests: recentApiRows.map(rowToApiRequestSummary),
    recentArticleFetches: recentArticleFetchRows.map(rowToArticleFetchSummary)
  };
}

export function listThreads(feedId: string | null, page = 0, pageSize = 100, unreadOnly = false): ThreadListPage {
  const db = getDatabase();
  const activeModel = getActiveModel();
  const titleModel = getTitleGenerationModel();
  const summaryTitlePromptHash = buildThreadTitlePromptHash(true);
  const plainTitlePromptHash = buildThreadTitlePromptHash(false);
  const safePage = Math.max(0, Math.floor(page));
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  const filterUnread = unreadOnly ? 1 : 0;
  if (feedId === null) {
    return listAllThreads(db, activeModel, titleModel, safePage, safePageSize, filterUnread);
  }
  const countRow = db.prepare(`
    SELECT COUNT(*) AS total_count
    FROM feed_items fi
    WHERE (? IS NULL OR fi.feed_id = ?)
      AND (? = 0 OR fi.read_at IS NULL)
  `).get(feedId, feedId, filterUnread) as { total_count: number };
  const rows = db
    .prepare(
      `
      SELECT
        fi.id,
        fi.feed_id,
        fi.title AS original_title,
        fi.url,
        COALESCE(generated_vt.title, raw_vt.title, fi.title) AS thread_title,
        fs.title AS source,
        fi.published_at,
        fi.read_at,
        fi.is_favorite,
        fi.generation_status,
        CASE
          WHEN generated_vt.id IS NOT NULL THEN NULL
          WHEN (SELECT status FROM title_generation_attempts WHERE feed_item_id = fi.id ORDER BY attempted_at DESC, rowid DESC LIMIT 1) = 'failed' THEN 'failed'
          ELSE 'skipped'
        END AS title_generation_status,
        fi.raw_summary,
        COALESCE((SELECT COUNT(*) FROM thread_posts WHERE feed_item_id = fi.id), COALESCE(rss_ts.response_count, 0) + COALESCE(response_ts.response_count, 0), 1) AS response_count
      FROM feed_items fi
      INNER JOIN feed_sources fs ON fs.id = fi.feed_id
      LEFT JOIN thread_titles generated_vt
        ON generated_vt.feed_item_id = fi.id
        AND generated_vt.model = ?
        AND generated_vt.prompt_hash = CASE
          WHEN fs.generate_title_from_summary = 1 THEN ?
          ELSE ?
        END
      LEFT JOIN thread_titles raw_vt
        ON raw_vt.feed_item_id = fi.id
        AND raw_vt.model = ?
        AND raw_vt.prompt_hash = ?
      LEFT JOIN thread_summaries rss_ts
        ON rss_ts.feed_item_id = fi.id
        AND rss_ts.model = ?
        AND rss_ts.prompt_hash = ?
      LEFT JOIN feed_resident_prompts frp
        ON frp.feed_id = fi.feed_id
      LEFT JOIN thread_summaries response_ts
        ON response_ts.feed_item_id = fi.id
        AND response_ts.model = ?
        AND response_ts.prompt_hash = (? || ':' || COALESCE(frp.prompt_hash, ?))
      WHERE (? IS NULL OR fi.feed_id = ?)
        AND (? = 0 OR fi.read_at IS NULL)
      ORDER BY
        CASE WHEN fi.read_at IS NULL THEN 0 ELSE 1 END ASC,
        COALESCE(fi.published_at, fi.created_at) DESC,
        fi.created_at DESC,
        fi.id DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(
      titleModel,
      summaryTitlePromptHash,
      plainTitlePromptHash,
      titleModel,
      rawTitlePromptHash,
      activeModel,
      rssSummaryPromptHash,
      activeModel,
      threadResponsePromptHash,
      defaultResidentPromptHash,
      feedId,
      feedId,
      filterUnread,
      safePageSize,
      safePage * safePageSize
    ) as ThreadRow[];

  return {
    items: rows.map(rowToThreadListItem),
    totalCount: Number(countRow.total_count),
    page: safePage,
    pageSize: safePageSize
  };
}

function listAllThreads(
  db: ReturnType<typeof getDatabase>,
  activeModel: string,
  titleModel: string,
  page: number,
  pageSize: number,
  filterUnread: number,
  generationQueueMode: "none" | "unreviewed" | "reviewed" = "none"
): ThreadListPage {
  const summaryTitlePromptHash = buildThreadTitlePromptHash(true);
  const plainTitlePromptHash = buildThreadTitlePromptHash(false);
  const canonicalKey = "COALESCE(NULLIF(fi.canonical_url, ''), fi.url)";
  const generationCondition =
    generationQueueMode === "unreviewed"
      ? "AND fi.generation_status = 'completed' AND fi.generation_reviewed_at IS NULL"
      : generationQueueMode === "reviewed"
        ? "AND fi.generation_status = 'completed' AND fi.generation_reviewed_at IS NOT NULL"
        : "";
  const countRow = db.prepare(`
    SELECT COUNT(DISTINCT ${canonicalKey}) AS total_count
    FROM feed_items fi
    WHERE (? = 0 OR fi.read_at IS NULL)
      ${generationCondition}
  `).get(filterUnread) as { total_count: number };
  const rows = db.prepare(`
    WITH ranked_items AS (
      SELECT
        fi.*,
        ${canonicalKey} AS article_key,
        ROW_NUMBER() OVER (
          PARTITION BY ${canonicalKey}
          ORDER BY
            CASE WHEN fi.read_at IS NULL THEN 0 ELSE 1 END,
            COALESCE(fi.published_at, fi.created_at) DESC,
            fi.created_at DESC,
            fi.id DESC
        ) AS article_rank
      FROM feed_items fi
      WHERE (? = 0 OR fi.read_at IS NULL)
        ${generationCondition}
    ),
    source_names AS (
      SELECT article_key, GROUP_CONCAT(title, ' / ') AS source
      FROM (
        SELECT DISTINCT
          COALESCE(NULLIF(fi.canonical_url, ''), fi.url) AS article_key,
          fs.title AS title
        FROM feed_items fi
        INNER JOIN feed_sources fs ON fs.id = fi.feed_id
        ORDER BY fs.title
      )
      GROUP BY article_key
    )
    SELECT
      fi.id,
      fi.feed_id,
      fi.title AS original_title,
      fi.url,
      COALESCE(generated_vt.title, raw_vt.title, fi.title) AS thread_title,
      source_names.source,
      fi.published_at,
      fi.read_at,
      fi.is_favorite,
      fi.generation_status,
      CASE
        WHEN generated_vt.id IS NOT NULL THEN NULL
        WHEN (SELECT status FROM title_generation_attempts WHERE feed_item_id = fi.id ORDER BY attempted_at DESC, rowid DESC LIMIT 1) = 'failed' THEN 'failed'
        ELSE 'skipped'
      END AS title_generation_status,
      fi.raw_summary,
      COALESCE((SELECT COUNT(*) FROM thread_posts WHERE feed_item_id = fi.id), COALESCE(rss_ts.response_count, 0) + COALESCE(response_ts.response_count, 0), 1) AS response_count
    FROM ranked_items fi
    INNER JOIN feed_sources fs ON fs.id = fi.feed_id
    INNER JOIN source_names ON source_names.article_key = fi.article_key
    LEFT JOIN thread_titles generated_vt
      ON generated_vt.feed_item_id = fi.id
      AND generated_vt.model = ?
      AND generated_vt.prompt_hash = CASE
        WHEN fs.generate_title_from_summary = 1 THEN ?
        ELSE ?
      END
    LEFT JOIN thread_titles raw_vt
      ON raw_vt.feed_item_id = fi.id AND raw_vt.model = ? AND raw_vt.prompt_hash = ?
    LEFT JOIN thread_summaries rss_ts
      ON rss_ts.feed_item_id = fi.id AND rss_ts.model = ? AND rss_ts.prompt_hash = ?
    LEFT JOIN feed_resident_prompts frp ON frp.feed_id = fi.feed_id
    LEFT JOIN thread_summaries response_ts
      ON response_ts.feed_item_id = fi.id
      AND response_ts.model = ?
      AND response_ts.prompt_hash = (? || ':' || COALESCE(frp.prompt_hash, ?))
    WHERE fi.article_rank = 1
    ORDER BY
      ${generationQueueMode === "unreviewed" ? "fi.generation_completed_at ASC," : ""}
      ${generationQueueMode === "reviewed" ? "fi.generation_reviewed_at DESC," : ""}
      CASE WHEN fi.read_at IS NULL THEN 0 ELSE 1 END,
      COALESCE(fi.published_at, fi.created_at) DESC,
      fi.created_at DESC,
      fi.id DESC
    LIMIT ? OFFSET ?
  `).all(
    filterUnread,
    titleModel,
    summaryTitlePromptHash,
    plainTitlePromptHash,
    titleModel,
    rawTitlePromptHash,
    activeModel,
    rssSummaryPromptHash,
    activeModel,
    threadResponsePromptHash,
    defaultResidentPromptHash,
    pageSize,
    page * pageSize
  ) as ThreadRow[];

  return { items: rows.map(rowToThreadListItem), totalCount: Number(countRow.total_count), page, pageSize };
}

export function listGeneratedQueue(page = 0, pageSize = 100, reviewed = false): ThreadListPage {
  const safePage = Math.max(0, Math.floor(page));
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  return listAllThreads(
    getDatabase(),
    getActiveModel(),
    getTitleGenerationModel(),
    safePage,
    safePageSize,
    0,
    reviewed ? "reviewed" : "unreviewed"
  );
}

export function getReadingQueueSummary(): ReadingQueueSummary {
  const db = getDatabase();
  const unreadCount = countAllUnreadArticles();
  const rows = db.prepare(`
    SELECT generation_status AS status, COUNT(*) AS count
    FROM feed_items
    WHERE generation_status IN ('queued', 'generating', 'completed')
      AND (generation_status != 'completed' OR generation_reviewed_at IS NULL)
    GROUP BY generation_status
  `).all() as Array<{ status: string; count: number }>;
  const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
  const reviewedRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM feed_items
    WHERE generation_status = 'completed' AND generation_reviewed_at IS NOT NULL
  `).get() as { count: number };
  return {
    unreadCount,
    queuedCount: counts.get("queued") ?? 0,
    generatingCount: counts.get("generating") ?? 0,
    completedCount: counts.get("completed") ?? 0,
    reviewedCount: Number(reviewedRow.count)
  };
}

function rowToRssRefreshRunSummary(row: RssRunRow): RssRefreshRunSummary {
  return {
    id: row.id,
    feedId: row.feed_id,
    feedUrl: row.feed_url,
    status: row.status,
    fetchedCount: Number(row.fetched_count),
    insertedCount: Number(row.inserted_count),
    updatedCount: Number(row.updated_count),
    skippedCount: Number(row.skipped_count),
    convertedCount: Number(row.converted_count),
    conversionFailedCount: Number(row.conversion_failed_count),
    conversionSkippedCount: Number(row.conversion_skipped_count),
    errorMessage: row.error_message,
    finishedAt: row.finished_at
  };
}

function rowToApiRequestSummary(row: ApiRequestRow): ApiRequestSummary {
  return {
    id: row.id,
    feedId: row.feed_id,
    purpose: row.purpose,
    model: row.model,
    promptHash: row.prompt_hash,
    status: row.status,
    requestCount: Number(row.request_count),
    itemCount: Number(row.item_count),
    promptChars: Number(row.prompt_chars),
    responseChars: Number(row.response_chars),
    promptTokenCount: row.prompt_token_count,
    candidatesTokenCount: row.candidates_token_count,
    totalTokenCount: row.total_token_count,
    cachedContentTokenCount: row.cached_content_token_count,
    errorMessage: row.error_message,
    finishedAt: row.finished_at
  };
}

type ArticleFetchRow = {
  id: string;
  feed_item_id: string | null;
  url: string;
  status: string;
  robots_result: string;
  elapsed_ms: number;
  content_size: number;
  error_message: string | null;
  fetched_at: string;
};

function rowToArticleFetchSummary(row: ArticleFetchRow): ArticleFetchSummary {
  return {
    id: row.id,
    feedItemId: row.feed_item_id,
    url: row.url,
    status: row.status,
    robotsResult: row.robots_result,
    elapsedMs: Number(row.elapsed_ms),
    contentSize: Number(row.content_size),
    errorMessage: row.error_message,
    fetchedAt: row.fetched_at
  };
}

type ThreadPostRow = {
  no: number;
  name: string;
  mail: string | null;
  date: string;
  uid: string;
  body: string;
  is_user: number;
};

export function getThread(threadId: string): ThreadDetail | null {
  const db = getDatabase();
  const activeModel = getActiveModel();
  const titleModel = getTitleGenerationModel();
  const summaryTitlePromptHash = buildThreadTitlePromptHash(true);
  const plainTitlePromptHash = buildThreadTitlePromptHash(false);
  markThreadRead(threadId);

  // 1. thread_posts から取得を試みる
  const postsRows = db
    .prepare("SELECT no, name, mail, date, uid, body, is_user FROM thread_posts WHERE feed_item_id = ? ORDER BY no ASC")
    .all(threadId) as ThreadPostRow[];

  // 基本的なスレッド情報（threadTitle など）を取得するクエリ
  const threadInfoRow = db
    .prepare(`
      WITH source_names AS (
        SELECT article_key, GROUP_CONCAT(title, ' / ') AS source
        FROM (
          SELECT DISTINCT
            COALESCE(NULLIF(item.canonical_url, ''), item.url) AS article_key,
            source.title AS title
          FROM feed_items item
          INNER JOIN feed_sources source ON source.id = item.feed_id
          ORDER BY source.title
        )
        GROUP BY article_key
      )
      SELECT
        fi.id,
        fi.feed_id,
        fi.title AS original_title,
        fi.url,
        COALESCE(generated_vt.title, raw_vt.title, fi.title) AS thread_title,
        source_names.source,
        fi.published_at,
        fi.read_at,
        fi.is_favorite,
        fi.generation_status,
        CASE
          WHEN generated_vt.id IS NOT NULL THEN NULL
          WHEN (SELECT status FROM title_generation_attempts WHERE feed_item_id = fi.id ORDER BY attempted_at DESC, rowid DESC LIMIT 1) = 'failed' THEN 'failed'
          ELSE 'skipped'
        END AS title_generation_status,
        fi.raw_summary
      FROM feed_items fi
      INNER JOIN feed_sources fs ON fs.id = fi.feed_id
      INNER JOIN source_names
        ON source_names.article_key = COALESCE(NULLIF(fi.canonical_url, ''), fi.url)
      LEFT JOIN thread_titles generated_vt
        ON generated_vt.feed_item_id = fi.id
        AND generated_vt.model = ?
        AND generated_vt.prompt_hash = CASE
          WHEN fs.generate_title_from_summary = 1 THEN ?
          ELSE ?
        END
      LEFT JOIN thread_titles raw_vt
        ON raw_vt.feed_item_id = fi.id
        AND raw_vt.model = ?
        AND raw_vt.prompt_hash = ?
      WHERE fi.id = ?
    `)
    .get(
      titleModel,
      summaryTitlePromptHash,
      plainTitlePromptHash,
      titleModel,
      rawTitlePromptHash,
      threadId
    ) as {
      id: string;
      feed_id: string;
      original_title: string;
      url: string;
      thread_title: string;
      source: string;
      published_at: string | null;
      read_at: string | null;
      is_favorite: number;
      generation_status: ThreadListItem["generationStatus"];
      title_generation_status: "completed" | "failed" | "skipped" | null;
      raw_summary: string | null;
    } | undefined;

  if (!threadInfoRow) {
    return null;
  }

  const listItem = {
    id: threadInfoRow.id,
    feedId: threadInfoRow.feed_id,
    originalTitle: threadInfoRow.original_title,
    url: threadInfoRow.url,
    threadTitle: threadInfoRow.thread_title,
    source: threadInfoRow.source,
    publishedAt: threadInfoRow.published_at ?? "",
    isRead: threadInfoRow.read_at !== null,
    isFavorite: threadInfoRow.is_favorite === 1,
    generationStatus: threadInfoRow.generation_status,
    titleGenerationStatus:
      threadInfoRow.title_generation_status === "failed" || threadInfoRow.title_generation_status === "skipped"
        ? threadInfoRow.title_generation_status
        : null,
    responseCount: 0
  };

  if (postsRows.length > 0) {
    const posts: ThreadPost[] = postsRows.map((row) => ({
      no: row.no,
      name: row.name,
      mail: row.mail ?? undefined,
      date: row.date,
      id: row.uid,
      body: row.body,
      isUser: row.is_user === 1
    }));

    return {
      ...listItem,
      responseCount: posts.length,
      posts,
      replyRuns: listReplyGenerationRuns(threadId)
    };
  }

  // 2. thread_posts にデータがない場合は、古い thread_summaries または RSS から復元（移行）する
  const legacyRow = db
    .prepare(`
      SELECT
        rss_ts.posts_json,
        response_ts.posts_json AS response_posts_json
      FROM feed_items fi
      LEFT JOIN thread_summaries rss_ts
        ON rss_ts.feed_item_id = fi.id
        AND rss_ts.model = ?
        AND rss_ts.prompt_hash = ?
      LEFT JOIN feed_resident_prompts frp
        ON frp.feed_id = fi.feed_id
      LEFT JOIN thread_summaries response_ts
        ON response_ts.feed_item_id = fi.id
        AND response_ts.model = ?
        AND response_ts.prompt_hash = (? || ':' || COALESCE(frp.prompt_hash, ?))
      WHERE fi.id = ?
    `)
    .get(
      activeModel,
      rssSummaryPromptHash,
      activeModel,
      threadResponsePromptHash,
      defaultResidentPromptHash,
      threadId
    ) as { posts_json?: string; response_posts_json?: string } | undefined;

  const rssPosts = parsePosts(legacyRow?.posts_json);
  const responsePosts = parsePosts(legacyRow?.response_posts_json);

  const initialPosts = normalizeThreadPosts(
    {
      id: threadInfoRow.id,
      feed_id: threadInfoRow.feed_id,
      original_title: threadInfoRow.original_title,
      url: threadInfoRow.url,
      thread_title: threadInfoRow.thread_title,
      source: threadInfoRow.source,
      published_at: threadInfoRow.published_at,
      read_at: threadInfoRow.read_at,
      raw_summary: threadInfoRow.raw_summary,
      is_favorite: threadInfoRow.is_favorite,
      generation_status: threadInfoRow.generation_status,
      response_count: 0,
      posts_json: legacyRow?.posts_json ?? undefined,
      response_posts_json: legacyRow?.response_posts_json ?? undefined
    },
    rssPosts,
    responsePosts
  );

  // 移行したデータを thread_posts に保存
  saveGeneratedThreadPosts(threadId, initialPosts);

  return {
    ...listItem,
    responseCount: initialPosts.length,
    posts: initialPosts,
    replyRuns: listReplyGenerationRuns(threadId)
  };
}

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

  const deleteLegacyThread = db.prepare("DELETE FROM feed_items WHERE id = ?");

  db.exec("BEGIN");
  try {
    for (const [index, feed] of seedFeeds.entries()) {
      insertFeed.run(feed.id, feed.title, feed.url, now, now, feed.lastFetchedAt, index);
    }

    for (const threadId of legacySeedThreadIds) {
      deleteLegacyThread.run(threadId);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function rowToThreadListItem(row: ThreadRow): ThreadListItem {
  return {
    id: row.id,
    feedId: row.feed_id,
    originalTitle: row.original_title,
    url: row.url,
    threadTitle: row.thread_title,
    source: row.source,
    publishedAt: row.published_at ?? "",
    isRead: row.read_at !== null,
    isFavorite: row.is_favorite === 1,
    responseCount: Number(row.response_count),
    generationStatus: row.generation_status ?? null,
    titleGenerationStatus:
      row.title_generation_status === "failed" || row.title_generation_status === "skipped"
        ? row.title_generation_status
        : null
  };
}

function parsePosts(postsJson: string | undefined): ThreadPost[] {
  if (!postsJson) {
    return [];
  }

  try {
    return JSON.parse(postsJson) as ThreadPost[];
  } catch {
    return [];
  }
}

function normalizeThreadPosts(row: ThreadRow, posts: ThreadPost[], responsePosts: ThreadPost[]): ThreadPost[] {
  if (posts.length === 0) {
    return [
      ...createInitialPosts(
        {
          title: row.original_title,
          url: row.url,
          rawSummary: row.raw_summary
        },
        row.published_at ?? new Date().toISOString()
      ),
      ...responsePosts
    ];
  }

  return [
    ...posts.map((post) =>
      post.no === 1
        ? {
            ...post,
            body: createFirstPostBody(row.original_title, row.url, row.raw_summary)
          }
        : post
    ),
    ...responsePosts
  ];
}

export function listFavoriteThreads(): ThreadListItem[] {
  const db = getDatabase();
  const activeModel = getActiveModel();
  const titleModel = getTitleGenerationModel();
  const summaryTitlePromptHash = buildThreadTitlePromptHash(true);
  const plainTitlePromptHash = buildThreadTitlePromptHash(false);
  const rows = db
    .prepare(
      `
      SELECT
        fi.id,
        fi.feed_id,
        fi.title AS original_title,
        fi.url,
        COALESCE(generated_vt.title, raw_vt.title, fi.title) AS thread_title,
        fs.title AS source,
        fi.published_at,
        fi.read_at,
        fi.is_favorite,
        fi.generation_status,
        CASE
          WHEN generated_vt.id IS NOT NULL THEN NULL
          WHEN (SELECT status FROM title_generation_attempts WHERE feed_item_id = fi.id ORDER BY attempted_at DESC, rowid DESC LIMIT 1) = 'failed' THEN 'failed'
          ELSE 'skipped'
        END AS title_generation_status,
        fi.raw_summary,
        COALESCE((SELECT COUNT(*) FROM thread_posts WHERE feed_item_id = fi.id), COALESCE(rss_ts.response_count, 0) + COALESCE(response_ts.response_count, 0), 1) AS response_count
      FROM feed_items fi
      INNER JOIN feed_sources fs ON fs.id = fi.feed_id
      LEFT JOIN thread_titles generated_vt
        ON generated_vt.feed_item_id = fi.id
        AND generated_vt.model = ?
        AND generated_vt.prompt_hash = CASE
          WHEN fs.generate_title_from_summary = 1 THEN ?
          ELSE ?
        END
      LEFT JOIN thread_titles raw_vt
        ON raw_vt.feed_item_id = fi.id
        AND raw_vt.model = ?
        AND raw_vt.prompt_hash = ?
      LEFT JOIN thread_summaries rss_ts
        ON rss_ts.feed_item_id = fi.id
        AND rss_ts.model = ?
        AND rss_ts.prompt_hash = ?
      LEFT JOIN feed_resident_prompts frp
        ON frp.feed_id = fi.feed_id
      LEFT JOIN thread_summaries response_ts
        ON response_ts.feed_item_id = fi.id
        AND response_ts.model = ?
        AND response_ts.prompt_hash = (? || ':' || COALESCE(frp.prompt_hash, ?))
      WHERE fi.is_favorite = 1
      ORDER BY fi.updated_at DESC, COALESCE(fi.published_at, fi.created_at) DESC, fi.created_at DESC, fi.id DESC
      `
    )
    .all(
      titleModel,
      summaryTitlePromptHash,
      plainTitlePromptHash,
      titleModel,
      rawTitlePromptHash,
      activeModel,
      rssSummaryPromptHash,
      activeModel,
      threadResponsePromptHash,
      defaultResidentPromptHash
    ) as ThreadRow[];

  return rows.map(rowToThreadListItem);
}
