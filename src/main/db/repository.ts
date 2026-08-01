import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { seedFeeds } from "../../shared/seedData.js";
import type {
  RefreshFeedResult,
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
export {
  getStatistics,
  recordArticleFetchLog,
  recordLlmRequestLog,
  recordRssRefreshRun
} from "./statisticsRepository.js";
export type { ArticleFetchLogWrite } from "./statisticsRepository.js";
export type { LlmRequestLogWrite, RssRefreshRunWrite } from "./statisticsRepository.js";

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
