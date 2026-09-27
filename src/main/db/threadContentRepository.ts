import { getDatabase } from "./database.js";

export function deleteThreadContent(threadId: string): void {
  const db = getDatabase();
  db.exec("BEGIN");
  try {
    const item = db.prepare("SELECT id FROM feed_items WHERE id = ?").get(threadId);
    if (!item) throw new Error("記事が見つかりません。");

    // Article bodies are shared by canonical URL when read, so remove every matching cache.
    db.prepare(`
      DELETE FROM article_bodies WHERE feed_item_id IN (
        SELECT source.id FROM feed_items source
        JOIN feed_items target ON target.id = ?
        WHERE COALESCE(NULLIF(source.canonical_url, ''), source.url)
          = COALESCE(NULLIF(target.canonical_url, ''), target.url)
      )
    `).run(threadId);
    db.prepare("DELETE FROM thread_summaries WHERE feed_item_id = ?").run(threadId);
    db.prepare("DELETE FROM thread_posts WHERE feed_item_id = ? AND no > 1").run(threadId);
    db.prepare(`
      UPDATE feed_items SET
        generation_status = NULL,
        generation_requested_at = NULL,
        generation_completed_at = NULL,
        generation_reviewed_at = NULL,
        last_read_post_no = MIN(last_read_post_no, 1),
        generated_content_version = content_version,
        updated_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), threadId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
