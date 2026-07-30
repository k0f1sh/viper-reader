import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { seedFeeds } from "../../shared/seedData.js";
import type {
  ApiRequestSummary,
  ArticleFetchSummary,
  ReplyGenerationRun,
  ReplyRating,
  RefreshFeedResult,
  RssRefreshRunSummary,
  StatisticsSummary,
  ThreadDetail,
  ThreadGenerationAttempt,
  TitleGenerationAttempt,
  ThreadListItem,
  ThreadListPage,
  ThreadPost,
  ReadingQueueSummary
} from "../../shared/types.js";
import {
  defaultResidentPromptHash,
  vipThreadResponsePromptHash
} from "../prompts/vipThreadResponsePrompt.js";
import { buildVipTitlePromptHash } from "../prompts/vipTitlePrompt.js";
import { getActiveModel, getTitleGenerationModel } from "../settings/settingsService.js";
import { canonicalizeArticleUrl } from "../articles/canonicalUrl.js";
import {
  createFirstPostBody,
  createInitialPosts,
  rawTitlePromptHash,
  rssSummaryPromptHash
} from "../threads/initialThreadPosts.js";
import { getDatabase } from "./database.js";

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

type ThreadRow = {
  id: string;
  feed_id: string;
  original_title: string;
  url: string;
  vip_title: string;
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

export type VipTitleWrite = {
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

export type ThreadResponseWrite = {
  feedItemId: string;
  posts: ThreadPost[];
};

export type FeedItemInitialCacheSource = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  rawSummary: string | null;
};

const legacySeedThreadIds = ["qiita-1", "qiita-2", "qiita-4", "zenn-1", "personal-1"];

export function initializeRepository(): void {
  const db = getDatabase();
  seedDatabase(db);
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
): RefreshFeedResult {
  const db = getDatabase();
  const fetchedAt = new Date().toISOString();
  let insertedCount = 0;
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
  const deleteDerivedTitles = db.prepare("DELETE FROM vip_titles WHERE feed_item_id = ?");
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
    fetchedAt
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

export function saveRawVipTitleFallbacks(items: FeedItemInitialCacheSource[], model: string): number {
  if (items.length === 0) {
    return 0;
  }

  const db = getDatabase();
  const generatedAt = new Date().toISOString();
  const insertTitle = db.prepare(
    `
    INSERT OR IGNORE INTO vip_titles (id, feed_item_id, model, prompt_hash, title, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  );
  let savedCount = 0;

  db.exec("BEGIN");
  try {
    for (const item of items) {
      const result = insertTitle.run(
        createVipTitleId(item.id, model, rawTitlePromptHash),
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
      LEFT JOIN vip_titles vt
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

export function saveVipTitles(titles: VipTitleWrite[], model: string, promptHash: string): number {
  if (titles.length === 0) {
    return 0;
  }

  const db = getDatabase();
  const generatedAt = new Date().toISOString();
  const insertTitle = db.prepare(
    `
    INSERT OR IGNORE INTO vip_titles (id, feed_item_id, model, prompt_hash, title, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  );
  let savedCount = 0;

  db.exec("BEGIN");
  try {
    for (const title of titles) {
      const result = insertTitle.run(
        createVipTitleId(title.feedItemId, model, promptHash),
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

export function replaceVipTitle(title: VipTitleWrite, model: string, promptHash: string): void {
  const db = getDatabase();
  const generatedAt = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO vip_titles (id, feed_item_id, model, prompt_hash, title, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(feed_item_id, model, prompt_hash) DO UPDATE SET
      title = excluded.title,
      generated_at = excluded.generated_at
    `
  ).run(
    createVipTitleId(title.feedItemId, model, promptHash),
    title.feedItemId,
    model,
    promptHash,
    title.title,
    generatedAt
  );
}

function createVipTitleId(feedItemId: string, model: string, promptHash: string): string {
  return `vip-title:${feedItemId}:${model}:${promptHash}`;
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
  const summaryTitlePromptHash = buildVipTitlePromptHash(true);
  const plainTitlePromptHash = buildVipTitlePromptHash(false);
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
        COALESCE(generated_vt.title, raw_vt.title, fi.title) AS vip_title,
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
      LEFT JOIN vip_titles generated_vt
        ON generated_vt.feed_item_id = fi.id
        AND generated_vt.model = ?
        AND generated_vt.prompt_hash = CASE
          WHEN fs.generate_title_from_summary = 1 THEN ?
          ELSE ?
        END
      LEFT JOIN vip_titles raw_vt
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
      vipThreadResponsePromptHash,
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
  const summaryTitlePromptHash = buildVipTitlePromptHash(true);
  const plainTitlePromptHash = buildVipTitlePromptHash(false);
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
      COALESCE(generated_vt.title, raw_vt.title, fi.title) AS vip_title,
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
    LEFT JOIN vip_titles generated_vt
      ON generated_vt.feed_item_id = fi.id
      AND generated_vt.model = ?
      AND generated_vt.prompt_hash = CASE
        WHEN fs.generate_title_from_summary = 1 THEN ?
        ELSE ?
      END
    LEFT JOIN vip_titles raw_vt
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
    vipThreadResponsePromptHash,
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

export function setThreadGenerationState(
  threadId: string,
  status: "queued" | "generating" | "completed" | "failed"
): void {
  const now = new Date().toISOString();
  getDatabase().prepare(`
    UPDATE feed_items SET
      generation_status = ?,
      generation_requested_at = CASE WHEN ? = 'queued' THEN ? ELSE generation_requested_at END,
      generation_completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE NULL END,
      generation_reviewed_at = CASE WHEN ? = 'queued' THEN NULL ELSE generation_reviewed_at END,
      updated_at = ?
    WHERE id = ?
  `).run(status, status, now, status, now, status, now, threadId);
}

export function startThreadGenerationAttempt(threadId: string, force: boolean, model: string): string {
  const id = `thread-generation:${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO thread_generation_attempts
      (id, feed_item_id, status, stage, model, force, started_at)
    VALUES (?, ?, 'running', 'checking-cache', ?, ?, ?)
  `).run(id, threadId, model, force ? 1 : 0, startedAt);
  return id;
}

export function finishThreadGenerationAttempt(
  id: string,
  status: "completed" | "failed" | "skipped",
  stage: ThreadGenerationAttempt["stage"],
  errorMessage: string | null,
  technicalDetails: string | null = null
): void {
  getDatabase().prepare(`
    UPDATE thread_generation_attempts
    SET status = ?, stage = ?, error_message = ?, technical_details = ?, finished_at = ?
    WHERE id = ?
  `).run(
    status,
    stage,
    truncateGenerationError(errorMessage),
    truncateGenerationError(technicalDetails),
    new Date().toISOString(),
    id
  );
}

export function listThreadGenerationAttempts(threadId: string, limit = 5): ThreadGenerationAttempt[] {
  const safeLimit = Math.min(20, Math.max(1, Math.floor(limit)));
  const rows = getDatabase().prepare(`
    SELECT
      id,
      feed_item_id,
      status,
      stage,
      error_message,
      technical_details,
      model,
      force,
      started_at,
      finished_at
    FROM thread_generation_attempts
    WHERE feed_item_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(threadId, safeLimit) as Array<{
    id: string;
    feed_item_id: string;
    status: ThreadGenerationAttempt["status"];
    stage: ThreadGenerationAttempt["stage"];
    error_message: string | null;
    technical_details: string | null;
    model: string;
    force: number;
    started_at: string;
    finished_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    threadId: row.feed_item_id,
    status: row.status,
    stage: row.stage,
    errorMessage: row.error_message,
    technicalDetails: row.technical_details,
    model: row.model,
    force: row.force === 1,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }));
}

function truncateGenerationError(value: string | null): string | null {
  if (!value) return null;
  return value.slice(0, 8_000);
}

export function markThreadGenerationReviewed(threadId: string): void {
  const now = new Date().toISOString();
  getDatabase().prepare(`
    UPDATE feed_items
    SET generation_reviewed_at = COALESCE(generation_reviewed_at, ?), updated_at = ?
    WHERE id = ? AND generation_status = 'completed'
  `).run(now, now, threadId);
}

export function countAllUnreadArticles(): number {
  const row = getDatabase().prepare(`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(canonical_url, ''), url)) AS count
    FROM feed_items
    WHERE read_at IS NULL
  `).get() as { count: number };
  return Number(row.count);
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
  const summaryTitlePromptHash = buildVipTitlePromptHash(true);
  const plainTitlePromptHash = buildVipTitlePromptHash(false);
  markThreadRead(threadId);

  // 1. thread_posts から取得を試みる
  const postsRows = db
    .prepare("SELECT no, name, mail, date, uid, body, is_user FROM thread_posts WHERE feed_item_id = ? ORDER BY no ASC")
    .all(threadId) as ThreadPostRow[];

  // 基本的なスレッド情報（vipTitle など）を取得するクエリ
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
        COALESCE(generated_vt.title, raw_vt.title, fi.title) AS vip_title,
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
      LEFT JOIN vip_titles generated_vt
        ON generated_vt.feed_item_id = fi.id
        AND generated_vt.model = ?
        AND generated_vt.prompt_hash = CASE
          WHEN fs.generate_title_from_summary = 1 THEN ?
          ELSE ?
        END
      LEFT JOIN vip_titles raw_vt
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
      vip_title: string;
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
    vipTitle: threadInfoRow.vip_title,
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
      vipThreadResponsePromptHash,
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
      vip_title: threadInfoRow.vip_title,
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

export function listReplyGenerationRuns(threadId: string): ReplyGenerationRun[] {
  const rows = getDatabase().prepare(`
    SELECT r.id, r.feed_item_id, r.start_no, r.end_no, r.mode, r.prompt_version_id,
           f.rating, f.tags_json
    FROM reply_generation_runs r
    LEFT JOIN reply_feedback f ON f.run_id = r.id
    WHERE r.feed_item_id = ? AND r.status = 'success'
    ORDER BY r.start_no
  `).all(threadId) as any[];
  return rows.map((row) => ({
    id: row.id, threadId: row.feed_item_id, startNo: row.start_no, endNo: row.end_no,
    mode: row.mode, promptVersionId: row.prompt_version_id,
    rating: row.rating as ReplyRating | null,
    feedbackTags: row.tags_json ? JSON.parse(row.tags_json) : []
  }));
}

export function recordReplyGenerationRun(params: {
  id: string; feedId: string; threadId: string; mode: string; model: string;
  promptVersionId: string | null; promptHash: string; startNo: number; endNo: number;
}): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO reply_generation_runs
    (id, feed_id, feed_item_id, mode, model, prompt_version_id, prompt_hash, start_no, end_no, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?)
  `).run(params.id, params.feedId, params.threadId, params.mode, params.model, params.promptVersionId,
    params.promptHash, params.startNo, params.endNo, new Date().toISOString());
  db.prepare("UPDATE thread_posts SET generation_run_id = ? WHERE feed_item_id = ? AND no BETWEEN ? AND ?")
    .run(params.id, params.threadId, params.startNo, params.endNo);
  db.prepare(`
    UPDATE thread_posts
    SET resident_id = (SELECT id FROM feed_residents WHERE feed_id = ? AND stable_uid = thread_posts.uid LIMIT 1)
    WHERE feed_item_id = ? AND no BETWEEN ? AND ?
  `).run(params.feedId, params.threadId, params.startNo, params.endNo);
}

export function markLatestReplyRunContinued(threadId: string, kind: "user" | "thread"): void {
  const column = kind === "user" ? "user_continued_at" : "continued_thread_at";
  getDatabase().prepare(`UPDATE reply_generation_runs SET ${column} = ? WHERE id = (
    SELECT id FROM reply_generation_runs WHERE feed_item_id = ? ORDER BY created_at DESC LIMIT 1
  )`).run(new Date().toISOString(), threadId);
}

export function saveThreadResponsePosts(write: ThreadResponseWrite, model: string, promptHash: string): number {
  const db = getDatabase();
  const generatedAt = new Date().toISOString();
  const result = db
    .prepare(
      `
      INSERT OR REPLACE INTO thread_summaries
      (id, feed_item_id, model, prompt_hash, posts_json, response_count, generated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(
      `thread-summary:${write.feedItemId}:${promptHash}`,
      write.feedItemId,
      model,
      promptHash,
      JSON.stringify(write.posts),
      write.posts.length,
      generatedAt
    );

  // thread_postsテーブルへの保存
  const userPostCountRow = db
    .prepare("SELECT COUNT(*) AS count FROM thread_posts WHERE feed_item_id = ? AND is_user = 1")
    .get(write.feedItemId) as { count: number } | undefined;
  
  const hasUserPost = (userPostCountRow?.count ?? 0) > 0;

  if (!hasUserPost) {
    db.prepare("DELETE FROM thread_posts WHERE feed_item_id = ? AND no > 1").run(write.feedItemId);
    
    const firstPostExistsRow = db
      .prepare("SELECT COUNT(*) AS count FROM thread_posts WHERE feed_item_id = ? AND no = 1")
      .get(write.feedItemId) as { count: number } | undefined;
      
    if ((firstPostExistsRow?.count ?? 0) === 0) {
      const threadInfo = db
        .prepare(`
          SELECT fi.title, fi.url, fi.raw_summary, fi.published_at
          FROM feed_items fi WHERE fi.id = ?
        `)
        .get(write.feedItemId) as { title: string; url: string; raw_summary: string | null; published_at: string | null } | undefined;
        
      if (threadInfo) {
        const initialPosts = createInitialPosts(
          {
            title: threadInfo.title,
            url: threadInfo.url,
            rawSummary: threadInfo.raw_summary
          },
          threadInfo.published_at ?? new Date().toISOString()
        );
        saveGeneratedThreadPosts(write.feedItemId, initialPosts);
      }
    }

    saveGeneratedThreadPosts(write.feedItemId, write.posts);
  }

  return Number(result.changes);
}

export function saveGeneratedThreadPosts(feedItemId: string, posts: ThreadPost[]): void {
  const db = getDatabase();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO thread_posts (id, feed_item_id, no, name, mail, date, uid, body, is_user, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    for (const post of posts) {
      const id = `post:${feedItemId}:${post.no}`;
      insert.run(
        id,
        feedItemId,
        post.no,
        post.name,
        post.mail ?? null,
        post.date,
        post.id,
        post.body,
        post.isUser ? 1 : 0,
        now
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function postUserMessage(params: {
  feedItemId: string;
  no: number;
  name: string;
  mail: string | null;
  date: string;
  uid: string;
  body: string;
}): void {
  const db = getDatabase();
  const id = `post:${params.feedItemId}:${params.no}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO thread_posts (id, feed_item_id, no, name, mail, date, uid, body, is_user, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    id,
    params.feedItemId,
    params.no,
    params.name,
    params.mail,
    params.date,
    params.uid,
    params.body,
    now
  );
}

export function getArticleBody(feedItemId: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare(`
      SELECT ab.content_text
      FROM article_bodies ab
      INNER JOIN feed_items source_item ON source_item.id = ab.feed_item_id
      INNER JOIN feed_items target_item ON target_item.id = ?
      WHERE COALESCE(NULLIF(source_item.canonical_url, ''), source_item.url)
        = COALESCE(NULLIF(target_item.canonical_url, ''), target_item.url)
      ORDER BY ab.fetched_at DESC
      LIMIT 1
    `)
    .get(feedItemId) as { content_text: string } | undefined;
  return row ? row.content_text : null;
}

export function saveArticleBody(feedItemId: string, url: string, contentText: string): void {
  const db = getDatabase();
  const contentHash = crypto.createHash("sha1").update(contentText).digest("hex");
  const id = `article-body:${feedItemId}:${contentHash.slice(0, 10)}`;
  const fetchedAt = new Date().toISOString();

  db.prepare(
    `
    INSERT OR REPLACE INTO article_bodies (id, feed_item_id, url, content_text, content_hash, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  ).run(id, feedItemId, url, contentText, contentHash, fetchedAt);
}

export function getArticleSummary(feedItemId: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare(`
      SELECT ab.summary_text
      FROM article_bodies ab
      INNER JOIN feed_items source_item ON source_item.id = ab.feed_item_id
      INNER JOIN feed_items target_item ON target_item.id = ?
      WHERE COALESCE(NULLIF(source_item.canonical_url, ''), source_item.url)
        = COALESCE(NULLIF(target_item.canonical_url, ''), target_item.url)
        AND ab.summary_text IS NOT NULL
      ORDER BY ab.fetched_at DESC
      LIMIT 1
    `)
    .get(feedItemId) as { summary_text: string | null } | undefined;
  return row ? row.summary_text : null;
}

export function saveArticleSummary(feedItemId: string, summaryText: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE article_bodies SET summary_text = ? WHERE id = (
      SELECT ab.id
      FROM article_bodies ab
      INNER JOIN feed_items source_item ON source_item.id = ab.feed_item_id
      INNER JOIN feed_items target_item ON target_item.id = ?
      WHERE COALESCE(NULLIF(source_item.canonical_url, ''), source_item.url)
        = COALESCE(NULLIF(target_item.canonical_url, ''), target_item.url)
      ORDER BY ab.fetched_at DESC
      LIMIT 1
    )
  `)
    .run(summaryText, feedItemId);
}

export function markThreadRead(threadId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE feed_items
    SET read_at = COALESCE(read_at, ?), updated_at = ?
    WHERE COALESCE(NULLIF(canonical_url, ''), url) = (
      SELECT COALESCE(NULLIF(canonical_url, ''), url) FROM feed_items WHERE id = ?
    )
  `).run(now, now, threadId);
}

export function setThreadRead(threadId: string, isRead: boolean): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE feed_items
    SET read_at = ?, updated_at = ?
    WHERE COALESCE(NULLIF(canonical_url, ''), url) = (
      SELECT COALESCE(NULLIF(canonical_url, ''), url) FROM feed_items WHERE id = ?
    )
  `).run(isRead ? now : null, now, threadId);
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
    vipTitle: row.vip_title,
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

export function setThreadFavorite(threadId: string, isFavorite: boolean): void {
  const db = getDatabase();
  db.prepare("UPDATE feed_items SET is_favorite = ?, updated_at = ? WHERE id = ?")
    .run(isFavorite ? 1 : 0, new Date().toISOString(), threadId);
}

export function listFavoriteThreads(): ThreadListItem[] {
  const db = getDatabase();
  const activeModel = getActiveModel();
  const titleModel = getTitleGenerationModel();
  const summaryTitlePromptHash = buildVipTitlePromptHash(true);
  const plainTitlePromptHash = buildVipTitlePromptHash(false);
  const rows = db
    .prepare(
      `
      SELECT
        fi.id,
        fi.feed_id,
        fi.title AS original_title,
        fi.url,
        COALESCE(generated_vt.title, raw_vt.title, fi.title) AS vip_title,
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
      LEFT JOIN vip_titles generated_vt
        ON generated_vt.feed_item_id = fi.id
        AND generated_vt.model = ?
        AND generated_vt.prompt_hash = CASE
          WHEN fs.generate_title_from_summary = 1 THEN ?
          ELSE ?
        END
      LEFT JOIN vip_titles raw_vt
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
      vipThreadResponsePromptHash,
      defaultResidentPromptHash
    ) as ThreadRow[];

  return rows.map(rowToThreadListItem);
}
