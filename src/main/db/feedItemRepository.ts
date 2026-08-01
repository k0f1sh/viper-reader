import crypto from "node:crypto";
import type { RefreshFeedResult, TitleGenerationAttempt } from "../../shared/types.js";
import { canonicalizeArticleUrl } from "../articles/canonicalUrl.js";
import {
  createInitialPosts,
  rawTitlePromptHash,
  rssSummaryPromptHash
} from "../threads/initialThreadPosts.js";
import { getDatabase } from "./database.js";
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
