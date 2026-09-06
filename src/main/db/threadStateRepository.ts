import { getDatabase } from "./database.js";
import { runWithSlowQueryLog } from "./slowQueryLogger.js";

export function countAllUnreadArticles(): number {
  const row = runWithSlowQueryLog("countAllUnreadArticles", () => getDatabase().prepare(`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(canonical_url, ''), url)) AS count
    FROM feed_items
    WHERE read_at IS NULL
  `).get()) as { count: number };
  return Number(row.count);
}

export function markThreadRead(threadId: string): void {
  updateThreadReadState(threadId, new Date().toISOString(), true);
}

// Only advance the displayed thread's post position; canonical siblings may have different posts.
export function markThreadPostsRead(threadId: string, postNo: number): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE feed_items SET read_at = COALESCE(read_at, ?), updated_at = ?,
      last_read_post_no = CASE WHEN id = ? THEN
        MAX(last_read_post_no, MIN(?,
          COALESCE((SELECT MAX(no) FROM thread_posts WHERE feed_item_id = ?), 0)))
        ELSE last_read_post_no END
    WHERE COALESCE(NULLIF(canonical_url, ''), url) = (
      SELECT COALESCE(NULLIF(canonical_url, ''), url) FROM feed_items WHERE id = ?
    )
  `).run(now, now, threadId, postNo, threadId, threadId);
}

export function setThreadRead(threadId: string, isRead: boolean): void {
  updateThreadReadState(threadId, isRead ? new Date().toISOString() : null, false);
}

export function setThreadFavorite(threadId: string, isFavorite: boolean): void {
  getDatabase().prepare("UPDATE feed_items SET is_favorite = ?, updated_at = ? WHERE id = ?")
    .run(isFavorite ? 1 : 0, new Date().toISOString(), threadId);
}

function updateThreadReadState(threadId: string, readAt: string | null, preserveExisting: boolean): void {
  const now = readAt ?? new Date().toISOString();
  getDatabase().prepare(`
    UPDATE feed_items
    SET read_at = ${preserveExisting ? "COALESCE(read_at, ?)" : "?"},
        last_read_post_no = CASE
          WHEN ? IS NULL THEN last_read_post_no
          ELSE COALESCE((SELECT MAX(no) FROM thread_posts WHERE feed_item_id = feed_items.id), 0)
        END,
        updated_at = ?
    WHERE COALESCE(NULLIF(canonical_url, ''), url) = (
      SELECT COALESCE(NULLIF(canonical_url, ''), url) FROM feed_items WHERE id = ?
    )
  `).run(readAt, readAt, now, threadId);
}
