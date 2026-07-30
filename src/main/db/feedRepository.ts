import crypto from "node:crypto";
import type { FeedSource } from "../../shared/types.js";
import { getDatabase } from "./database.js";

type FeedRow = {
  id: string;
  title: string;
  url: string;
  unread_count: number;
  last_fetched_at: string | null;
  generate_title_from_summary: number;
};

type FeedSourceRow = {
  id: string;
  title: string;
  url: string;
  last_fetched_at: string | null;
  generate_title_from_summary: number;
};

export function listFeeds(): FeedSource[] {
  const rows = getDatabase().prepare(`
    SELECT
      fs.id,
      fs.title,
      fs.url,
      fs.last_fetched_at,
      fs.generate_title_from_summary,
      COUNT(CASE WHEN fi.read_at IS NULL THEN 1 END) AS unread_count
    FROM feed_sources fs
    LEFT JOIN feed_items fi ON fi.feed_id = fs.id
    GROUP BY fs.id
    ORDER BY fs.sort_order ASC, fs.created_at ASC
  `).all() as FeedRow[];

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    unreadCount: Number(row.unread_count),
    lastFetchedAt: row.last_fetched_at,
    generateTitleFromSummary: Boolean(row.generate_title_from_summary)
  }));
}

export function getFeedSource(feedId: string): FeedSource | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, title, url, last_fetched_at, generate_title_from_summary
    FROM feed_sources
    WHERE id = ?
  `).get(feedId) as FeedSourceRow | undefined;

  if (!row) return null;

  const unreadRow = db
    .prepare("SELECT COUNT(*) AS unread_count FROM feed_items WHERE feed_id = ? AND read_at IS NULL")
    .get(feedId) as { unread_count: number } | undefined;

  return {
    id: row.id,
    title: row.title,
    url: row.url,
    unreadCount: Number(unreadRow?.unread_count ?? 0),
    lastFetchedAt: row.last_fetched_at,
    generateTitleFromSummary: Boolean(row.generate_title_from_summary)
  };
}

export function markAllFeedsRead(): void {
  getDatabase().prepare("UPDATE feed_items SET read_at = COALESCE(read_at, datetime('now'))").run();
}

export function markFeedRead(feedId: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare("UPDATE feed_items SET read_at = COALESCE(read_at, ?), updated_at = ? WHERE feed_id = ?")
    .run(now, now, feedId);
}

export function addFeedSource(
  title: string,
  url: string,
  generateTitleFromSummary = false
): FeedSource {
  if (typeof title !== "string" || !title.trim() || title.length > 200 || typeof url !== "string" || url.length > 2048) {
    throw new Error("RSSフィードの入力が不正です。");
  }
  if (typeof generateTitleFromSummary !== "boolean") {
    throw new Error("タイトル生成設定が不正です。");
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("RSSフィードのURLが不正です。");
  }
  if (
    (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:")
    || parsedUrl.username
    || parsedUrl.password
  ) {
    throw new Error("RSSフィードには認証情報を含まないHTTPまたはHTTPS URLを指定してください。");
  }

  const db = getDatabase();
  const createdAt = new Date().toISOString();
  if (db.prepare("SELECT id FROM feed_sources WHERE url = ?").get(url)) {
    throw new Error("このRSSフィードは既に登録されています。");
  }

  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
  const id = `feed:${hash}`;
  const nextSortOrder = db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order FROM feed_sources"
  ).get() as { next_sort_order: number };

  db.prepare(`
    INSERT INTO feed_sources (id, title, url, created_at, updated_at, generate_title_from_summary, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, url, createdAt, createdAt, generateTitleFromSummary ? 1 : 0, nextSortOrder.next_sort_order);

  return {
    id,
    title,
    url,
    unreadCount: 0,
    lastFetchedAt: null,
    generateTitleFromSummary
  };
}

export function reorderFeedSources(feedIds: string[]): void {
  const db = getDatabase();
  const existingRows = db.prepare("SELECT id FROM feed_sources").all() as Array<{ id: string }>;
  const existingIds = new Set(existingRows.map((row) => row.id));
  if (
    feedIds.length !== existingIds.size
    || new Set(feedIds).size !== feedIds.length
    || feedIds.some((id) => !existingIds.has(id))
  ) {
    throw new Error("板一覧の並び順が不正です。");
  }

  const update = db.prepare("UPDATE feed_sources SET sort_order = ?, updated_at = ? WHERE id = ?");
  const updatedAt = new Date().toISOString();
  db.exec("BEGIN");
  try {
    feedIds.forEach((feedId, index) => update.run(index, updatedAt, feedId));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function deleteFeedSource(feedId: string): void {
  getDatabase().prepare("DELETE FROM feed_sources WHERE id = ?").run(feedId);
}

export function updateFeedTitleGenerationSetting(
  feedId: string,
  generateTitleFromSummary: boolean
): FeedSource {
  const db = getDatabase();
  const result = db.prepare(
    "UPDATE feed_sources SET generate_title_from_summary = ?, updated_at = ? WHERE id = ?"
  ).run(generateTitleFromSummary ? 1 : 0, new Date().toISOString(), feedId);
  if (result.changes === 0) {
    throw new Error(`Feed not found: ${feedId}`);
  }

  const feed = getFeedSource(feedId);
  if (!feed) {
    throw new Error(`Feed not found: ${feedId}`);
  }
  return feed;
}
