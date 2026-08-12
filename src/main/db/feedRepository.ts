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
  skip_title_conversion: number;
  parent_folder_id: string | null;
  sort_order: number | null;
};

type FeedSourceRow = {
  id: string;
  title: string;
  url: string;
  last_fetched_at: string | null;
  generate_title_from_summary: number;
  skip_title_conversion: number;
  parent_folder_id: string | null;
  sort_order: number | null;
};

export function listFeeds(): FeedSource[] {
  const rows = getDatabase().prepare(`
    SELECT
      fs.id,
      fs.title,
      fs.url,
      fs.last_fetched_at,
      fs.generate_title_from_summary,
      fs.skip_title_conversion,
      fs.parent_folder_id,
      fs.sort_order,
      COUNT(CASE WHEN fi.id IS NOT NULL AND fi.read_at IS NULL THEN 1 END) AS unread_count
    FROM feed_sources fs
    LEFT JOIN feed_items fi ON fi.feed_id = fs.id
    GROUP BY fs.id
    ORDER BY fs.parent_folder_id ASC, fs.sort_order ASC, fs.created_at ASC
  `).all() as FeedRow[];

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    url: row.url,
    unreadCount: Number(row.unread_count),
    lastFetchedAt: row.last_fetched_at,
    generateTitleFromSummary: Boolean(row.generate_title_from_summary),
    skipTitleConversion: Boolean(row.skip_title_conversion),
    parentFolderId: row.parent_folder_id,
    sortOrder: Number(row.sort_order ?? 0)
  }));
}

export function getFeedSource(feedId: string): FeedSource | null {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT id, title, url, last_fetched_at, generate_title_from_summary, skip_title_conversion, parent_folder_id, sort_order
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
    generateTitleFromSummary: Boolean(row.generate_title_from_summary),
    skipTitleConversion: Boolean(row.skip_title_conversion),
    parentFolderId: row.parent_folder_id,
    sortOrder: Number(row.sort_order ?? 0)
  };
}

export function markAllFeedsRead(): void {
  const now = new Date().toISOString();
  getDatabase().prepare(`
    UPDATE feed_items SET
      read_at = COALESCE(read_at, ?),
      last_read_post_no = COALESCE((SELECT MAX(no) FROM thread_posts WHERE feed_item_id = feed_items.id), 0),
      updated_at = ?
  `).run(now, now);
}

export function markFeedRead(feedId: string): void {
  const now = new Date().toISOString();
  getDatabase()
    .prepare(`
      UPDATE feed_items SET
        read_at = COALESCE(read_at, ?),
        last_read_post_no = COALESCE((SELECT MAX(no) FROM thread_posts WHERE feed_item_id = feed_items.id), 0),
        updated_at = ?
      WHERE feed_id = ?
    `)
    .run(now, now, feedId);
}

export function addFeedSource(
  title: string,
  url: string,
  generateTitleFromSummary = false,
  skipTitleConversion = false,
  parentFolderId: string | null = null
): FeedSource {
  if (typeof title !== "string" || !title.trim() || title.length > 200 || typeof url !== "string" || url.length > 2048) {
    throw new Error("RSSフィードの入力が不正です。");
  }
  if (typeof generateTitleFromSummary !== "boolean") {
    throw new Error("タイトル生成設定が不正です。");
  }
  if (typeof skipTitleConversion !== "boolean") {
    throw new Error("スレタイ変換設定が不正です。");
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
  if (parentFolderId !== null && !db.prepare("SELECT id FROM feed_folders WHERE id = ?").get(parentFolderId)) {
    throw new Error("配置先フォルダが見つかりません。");
  }
  const createdAt = new Date().toISOString();
  if (db.prepare("SELECT id FROM feed_sources WHERE url = ?").get(url)) {
    throw new Error("このRSSフィードは既に登録されています。");
  }

  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
  const id = `feed:${hash}`;
  const nextSortOrder = getNextChildSortOrder(db, parentFolderId);

  db.prepare(`
    INSERT INTO feed_sources (id, title, url, created_at, updated_at, generate_title_from_summary, skip_title_conversion, parent_folder_id, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, url, createdAt, createdAt, generateTitleFromSummary ? 1 : 0, skipTitleConversion ? 1 : 0, parentFolderId, nextSortOrder);

  return {
    id,
    title,
    url,
    unreadCount: 0,
    lastFetchedAt: null,
    generateTitleFromSummary,
    skipTitleConversion,
    parentFolderId,
    sortOrder: nextSortOrder
  };
}

function getNextChildSortOrder(db: ReturnType<typeof getDatabase>, parentFolderId: string | null): number {
  const feedMax = db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS value FROM feed_sources WHERE parent_folder_id IS ?"
  ).get(parentFolderId) as { value: number };
  const folderMax = db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS value FROM feed_folders WHERE parent_folder_id IS ?"
  ).get(parentFolderId) as { value: number };
  return Math.max(Number(feedMax.value), Number(folderMax.value)) + 1;
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

export function updateFeedSettings(
  feedId: string,
  title: string,
  generateTitleFromSummary: boolean,
  skipTitleConversion: boolean
): FeedSource {
  if (typeof generateTitleFromSummary !== "boolean" || typeof skipTitleConversion !== "boolean") {
    throw new Error("スレタイ生成設定が不正です。");
  }
  const normalizedTitle = title.trim();
  if (!normalizedTitle || normalizedTitle.length > 200) {
    throw new Error("板タイトルが不正です。");
  }
  const db = getDatabase();
  const result = db.prepare(
    "UPDATE feed_sources SET title = ?, generate_title_from_summary = ?, skip_title_conversion = ?, updated_at = ? WHERE id = ?"
  ).run(normalizedTitle, generateTitleFromSummary ? 1 : 0, skipTitleConversion ? 1 : 0, new Date().toISOString(), feedId);
  if (result.changes === 0) {
    throw new Error(`Feed not found: ${feedId}`);
  }

  const feed = getFeedSource(feedId);
  if (!feed) {
    throw new Error(`Feed not found: ${feedId}`);
  }
  return feed;
}
