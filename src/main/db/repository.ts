import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { appInfo } from "../../shared/appInfo.js";
import { seedFeeds } from "../../shared/seedData.js";
import type {
  ApiRequestSummary,
  ArticleFetchSummary,
  FeedResidentPrompt,
  FeedSource,
  RefreshFeedResult,
  RssRefreshRunSummary,
  StatisticsSummary,
  ThreadDetail,
  ThreadListItem,
  ThreadPost
} from "../../shared/types.js";
import {
  defaultResidentPromptHash,
  vipThreadResponsePromptHash
} from "../prompts/vipThreadResponsePrompt.js";
import { vipTitlePromptHash } from "../prompts/vipTitlePrompt.js";
import { getDatabase } from "./database.js";

type FeedRow = {
  id: string;
  title: string;
  url: string;
  unread_count: number;
  last_fetched_at: string | null;
};

type FeedSourceRow = {
  id: string;
  title: string;
  url: string;
  last_fetched_at: string | null;
};

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
  error_message: string | null;
  finished_at: string;
};

export type UnconvertedFeedItem = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
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
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
};

export type ThreadResponseWrite = {
  feedItemId: string;
  posts: ThreadPost[];
};

const rawTitlePromptHash = "raw-title-v1";
const rssSummaryPromptHash = "rss-summary-v1";
const legacySeedThreadIds = ["qiita-1", "qiita-2", "qiita-4", "zenn-1", "personal-1"];

export function initializeRepository(): void {
  const db = getDatabase();
  seedDatabase(db);
}

export function listFeeds(): FeedSource[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT
        fs.id,
        fs.title,
        fs.url,
        fs.last_fetched_at,
        COUNT(CASE WHEN fi.read_at IS NULL THEN 1 END) AS unread_count
      FROM feed_sources fs
      LEFT JOIN feed_items fi ON fi.feed_id = fs.id
      GROUP BY fs.id
      ORDER BY fs.created_at ASC
      `
    )
    .all() as FeedRow[];

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    unreadCount: Number(row.unread_count),
    lastFetchedAt: row.last_fetched_at
  }));
}

export function getFeedSource(feedId: string): FeedSource | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT id, title, url, last_fetched_at
      FROM feed_sources
      WHERE id = ?
      `
    )
    .get(feedId) as FeedSourceRow | undefined;

  if (!row) {
    return null;
  }

  const unreadRow = db
    .prepare("SELECT COUNT(*) AS unread_count FROM feed_items WHERE feed_id = ? AND read_at IS NULL")
    .get(feedId) as { unread_count: number } | undefined;

  return {
    id: row.id,
    title: row.title,
    url: row.url,
    unreadCount: Number(unreadRow?.unread_count ?? 0),
    lastFetchedAt: row.last_fetched_at
  };
}

export function getFeedResidentPrompt(feedId: string): FeedResidentPrompt | null {
  const db = getDatabase();
  const row = db
    .prepare(
      `
      SELECT feed_id, prompt, prompt_hash, updated_at
      FROM feed_resident_prompts
      WHERE feed_id = ?
      `
    )
    .get(feedId) as
    | {
        feed_id: string;
        prompt: string;
        prompt_hash: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    feedId: row.feed_id,
    prompt: row.prompt,
    promptHash: row.prompt_hash,
    updatedAt: row.updated_at
  };
}

export function saveFeedResidentPrompt(feedId: string, promptText: string): void {
  const db = getDatabase();
  const prompt = promptText.trim();
  if (!prompt) {
    throw new Error("Prompt text is empty.");
  }

  const promptHash = crypto.createHash("sha1").update(prompt).digest("hex").slice(0, 12);
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO feed_resident_prompts (feed_id, prompt, prompt_hash, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(feed_id) DO UPDATE SET
      prompt = excluded.prompt,
      prompt_hash = excluded.prompt_hash,
      updated_at = excluded.updated_at
    `
  ).run(feedId, prompt, promptHash, now);
}

export function clearFeedResidentPrompt(feedId: string): void {
  const db = getDatabase();
  db.prepare("DELETE FROM feed_resident_prompts WHERE feed_id = ?").run(feedId);
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
    INSERT INTO feed_items (id, feed_id, guid, title, url, published_at, raw_summary, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  );
  const updateItem = db.prepare(
    `
    UPDATE feed_items
    SET title = ?, url = ?, published_at = ?, raw_summary = ?, updated_at = ?
    WHERE id = ?
    `
  );
  const insertTitle = db.prepare(
    `
    INSERT OR IGNORE INTO vip_titles (id, feed_item_id, model, prompt_hash, title, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    `
  );
  const insertSummary = db.prepare(
    `
    INSERT OR IGNORE INTO thread_summaries
      (id, feed_item_id, model, prompt_hash, posts_json, response_count, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `
  );
  const updateFeed = db.prepare("UPDATE feed_sources SET last_fetched_at = ?, updated_at = ? WHERE id = ?");

  db.exec("BEGIN");
  try {
    for (const item of items) {
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
        updateItem.run(item.title, item.url, item.publishedAt, item.rawSummary, fetchedAt, feedItemId);
        updatedCount += 1;
      } else {
        skippedCount += 1;
      }

      insertTitle.run(
        `vip-title:${feedItemId}:raw`,
        feedItemId,
        appInfo.model,
        rawTitlePromptHash,
        item.title,
        fetchedAt
      );
      insertSummary.run(
        `thread-summary:${feedItemId}:rss`,
        feedItemId,
        appInfo.model,
        rssSummaryPromptHash,
        JSON.stringify(createInitialPosts(item, fetchedAt)),
        1,
        fetchedAt
      );
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

export function listUnconvertedFeedItems(
  feedId: string,
  model: string,
  promptHash: string
): UnconvertedFeedItem[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `
      SELECT fi.id, fi.title, fi.url, fi.published_at
      FROM feed_items fi
      LEFT JOIN vip_titles vt
        ON vt.feed_item_id = fi.id
        AND vt.model = ?
        AND vt.prompt_hash = ?
      WHERE fi.feed_id = ?
        AND vt.id IS NULL
      ORDER BY COALESCE(fi.published_at, fi.created_at) DESC, fi.created_at DESC, fi.id DESC
      `
    )
    .all(model, promptHash, feedId) as Array<{
      id: string;
      title: string;
      url: string;
      published_at: string | null;
    }>;

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    publishedAt: row.published_at
  }));
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
        `vip-title:${title.feedItemId}:${promptHash}`,
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
        error_message,
        started_at,
        finished_at
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

export function listThreads(feedId: string): ThreadListItem[] {
  const db = getDatabase();
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
        fi.raw_summary,
        COALESCE(rss_ts.response_count, 0) + COALESCE(response_ts.response_count, 0) AS response_count
      FROM feed_items fi
      INNER JOIN feed_sources fs ON fs.id = fi.feed_id
      LEFT JOIN vip_titles generated_vt
        ON generated_vt.feed_item_id = fi.id
        AND generated_vt.model = ?
        AND generated_vt.prompt_hash = ?
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
      WHERE fi.feed_id = ?
      ORDER BY COALESCE(fi.published_at, fi.created_at) DESC, fi.created_at DESC, fi.id DESC
      `
    )
    .all(
      appInfo.model,
      vipTitlePromptHash,
      appInfo.model,
      rawTitlePromptHash,
      appInfo.model,
      rssSummaryPromptHash,
      appInfo.model,
      vipThreadResponsePromptHash,
      defaultResidentPromptHash,
      feedId
    ) as ThreadRow[];

  return rows.map(rowToThreadListItem);
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

export function getThread(threadId: string): ThreadDetail | null {
  const db = getDatabase();
  markThreadRead(threadId);

  const row = db
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
        fi.raw_summary,
        COALESCE(rss_ts.response_count, 0) + COALESCE(response_ts.response_count, 0) AS response_count,
        rss_ts.posts_json,
        response_ts.posts_json AS response_posts_json
      FROM feed_items fi
      INNER JOIN feed_sources fs ON fs.id = fi.feed_id
      LEFT JOIN vip_titles generated_vt
        ON generated_vt.feed_item_id = fi.id
        AND generated_vt.model = ?
        AND generated_vt.prompt_hash = ?
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
      WHERE fi.id = ?
      `
    )
    .get(
      appInfo.model,
      vipTitlePromptHash,
      appInfo.model,
      rawTitlePromptHash,
      appInfo.model,
      rssSummaryPromptHash,
      appInfo.model,
      vipThreadResponsePromptHash,
      defaultResidentPromptHash,
      threadId
    ) as ThreadRow | undefined;

  if (!row) {
    return null;
  }

  return {
    ...rowToThreadListItem(row),
    posts: normalizeThreadPosts(row, parsePosts(row.posts_json), parsePosts(row.response_posts_json))
  };
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

  return Number(result.changes);
}

export function getArticleBody(feedItemId: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT content_text FROM article_bodies WHERE feed_item_id = ?")
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

export function markThreadRead(threadId: string): void {
  const db = getDatabase();
  db.prepare("UPDATE feed_items SET read_at = COALESCE(read_at, ?), updated_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    new Date().toISOString(),
    threadId
  );
}

function seedDatabase(db: DatabaseSync): void {
  const now = new Date().toISOString();

  const insertFeed = db.prepare(
    `
    INSERT INTO feed_sources (id, title, url, created_at, updated_at, last_fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      url = excluded.url,
      updated_at = excluded.updated_at
    `
  );

  const deleteLegacyThread = db.prepare("DELETE FROM feed_items WHERE id = ?");

  db.exec("BEGIN");
  try {
    for (const feed of seedFeeds) {
      insertFeed.run(feed.id, feed.title, feed.url, now, now, feed.lastFetchedAt);
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
    responseCount: Number(row.response_count)
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

function createInitialPosts(
  item: { title: string; url: string; rawSummary: string | null },
  fetchedAt: string
): ThreadPost[] {
  return [
    {
      no: 1,
      name: "以下、名無しにかわりましてVIPが技術記事をお送りします",
      date: formatVipDate(fetchedAt),
      id: "RssFetch00",
      body: createFirstPostBody(item.title, item.url, item.rawSummary)
    }
  ];
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

export function createFirstPostBody(title: string, url: string, rawSummary: string | null): string {
  const body = normalizeRssBody(rawSummary);
  return `元記事タイトル:
${title}

URL:
${url}

${body}`;
}

function normalizeRssBody(rawSummary: string | null): string {
  if (!rawSummary?.trim()) {
    return "RSS本文は空。タイトルとURLだけ置いとく。";
  }

  return rawSummary
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[ \u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatVipDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  const pad = (number: number, length = 2) => String(number).padStart(length, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}(${
    weekdays[date.getDay()]
  }) ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3
  )}`;
}

export function getUserSetting(key: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT value FROM user_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function saveUserSetting(key: string, value: string): void {
  const db = getDatabase();
  const updatedAt = new Date().toISOString();
  db.prepare(
    `
    INSERT OR REPLACE INTO user_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    `
  ).run(key, value, updatedAt);
}

export function addFeedSource(title: string, url: string): FeedSource {
  const db = getDatabase();
  const createdAt = new Date().toISOString();

  // URLの重複チェック
  const existing = db.prepare("SELECT id FROM feed_sources WHERE url = ?").get(url);
  if (existing) {
    throw new Error("このRSSフィードは既に登録されています。");
  }

  const hash = crypto
    .createHash("sha1")
    .update(url)
    .digest("hex")
    .slice(0, 16);
  const id = `feed:${hash}`;

  db.prepare(
    `
    INSERT INTO feed_sources (id, title, url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    `
  ).run(id, title, url, createdAt, createdAt);

  return {
    id,
    title,
    url,
    unreadCount: 0,
    lastFetchedAt: null
  };
}

export function deleteFeedSource(feedId: string): void {
  const db = getDatabase();
  db.prepare("DELETE FROM feed_sources WHERE id = ?").run(feedId);
}
