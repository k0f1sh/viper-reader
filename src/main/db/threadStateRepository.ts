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
