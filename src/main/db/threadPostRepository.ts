import type { ThreadPost } from "../../shared/types.js";
import { createInitialPosts } from "../threads/initialThreadPosts.js";
import { getDatabase } from "./database.js";

export type ThreadResponseWrite = {
  feedItemId: string;
  posts: ThreadPost[];
};

export function saveThreadResponsePosts(write: ThreadResponseWrite, model: string, promptHash: string): number {
  const db = getDatabase();
  const result = db.prepare(`
    INSERT OR REPLACE INTO thread_summaries
    (id, feed_item_id, model, prompt_hash, posts_json, response_count, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    `thread-summary:${write.feedItemId}:${promptHash}`,
    write.feedItemId,
    model,
    promptHash,
    JSON.stringify(write.posts),
    write.posts.length,
    new Date().toISOString()
  );

  const userPostCount = db
    .prepare("SELECT COUNT(*) AS count FROM thread_posts WHERE feed_item_id = ? AND is_user = 1")
    .get(write.feedItemId) as { count: number } | undefined;
  if ((userPostCount?.count ?? 0) === 0) {
    db.prepare("DELETE FROM thread_posts WHERE feed_item_id = ? AND no > 1").run(write.feedItemId);
    const firstPostCount = db
      .prepare("SELECT COUNT(*) AS count FROM thread_posts WHERE feed_item_id = ? AND no = 1")
      .get(write.feedItemId) as { count: number } | undefined;
    if ((firstPostCount?.count ?? 0) === 0) {
      const threadInfo = db.prepare(`
        SELECT title, url, raw_summary, published_at FROM feed_items WHERE id = ?
      `).get(write.feedItemId) as {
        title: string;
        url: string;
        raw_summary: string | null;
        published_at: string | null;
      } | undefined;
      if (threadInfo) {
        saveGeneratedThreadPosts(write.feedItemId, createInitialPosts({
          title: threadInfo.title,
          url: threadInfo.url,
          rawSummary: threadInfo.raw_summary
        }, threadInfo.published_at ?? new Date().toISOString()));
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
      insert.run(`post:${feedItemId}:${post.no}`, feedItemId, post.no, post.name, post.mail ?? null,
        post.date, post.id, post.body, post.isUser ? 1 : 0, now);
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
  getDatabase().prepare(`
    INSERT OR REPLACE INTO thread_posts (id, feed_item_id, no, name, mail, date, uid, body, is_user, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(`post:${params.feedItemId}:${params.no}`, params.feedItemId, params.no, params.name,
    params.mail, params.date, params.uid, params.body, new Date().toISOString());
}
