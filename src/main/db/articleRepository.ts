import crypto from "node:crypto";
import { getDatabase } from "./database.js";

export function getArticleBody(feedItemId: string): string | null {
  const row = getDatabase()
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
  return row?.content_text ?? null;
}

export function saveArticleBody(feedItemId: string, url: string, contentText: string): void {
  const contentHash = crypto.createHash("sha1").update(contentText).digest("hex");
  const id = `article-body:${feedItemId}:${contentHash.slice(0, 10)}`;

  getDatabase().prepare(`
    INSERT OR REPLACE INTO article_bodies (id, feed_item_id, url, content_text, content_hash, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, feedItemId, url, contentText, contentHash, new Date().toISOString());
}

export function getArticleSummary(feedItemId: string): string | null {
  const row = getDatabase()
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
  return row?.summary_text ?? null;
}

export function saveArticleSummary(feedItemId: string, summaryText: string): void {
  getDatabase().prepare(`
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
  `).run(summaryText, feedItemId);
}
