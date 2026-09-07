import { assertArticleVersion } from "./articleRepository.js";
import type { ThreadPost } from "../../shared/types.js";
import { createInitialPosts } from "../threads/initialThreadPosts.js";
import { getDatabase } from "./database.js";

export type ThreadResponseWrite = {
  feedItemId: string;
  posts: ThreadPost[];
  contentVersion?: number;
};

export function saveThreadResponsePosts(write: ThreadResponseWrite, model: string, promptHash: string): number {
  const db = getDatabase();
  return runInTransaction(() => {
    if (write.contentVersion !== undefined) assertArticleVersion(write.feedItemId, write.contentVersion);
    const version = db.prepare("SELECT content_version, generated_content_version FROM feed_items WHERE id = ?")
      .get(write.feedItemId) as { content_version: number; generated_content_version: number };
    if (version.content_version !== version.generated_content_version) {
      return saveUpdatedThreadResponsePosts(write, model, promptHash, version.content_version);
    }
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
          insertGeneratedThreadPosts(write.feedItemId, createInitialPosts({
            title: threadInfo.title,
            url: threadInfo.url,
            rawSummary: threadInfo.raw_summary
          }, threadInfo.published_at ?? new Date().toISOString()));
        }
      }
      insertGeneratedThreadPosts(write.feedItemId, write.posts);
    }
    return Number(result.changes);
  });
}

export function saveGeneratedThreadPosts(feedItemId: string, posts: ThreadPost[]): void {
  runInTransaction(() => insertGeneratedThreadPosts(feedItemId, posts));
}

function insertGeneratedThreadPosts(feedItemId: string, posts: ThreadPost[]): void {
  const insert = getDatabase().prepare(`
    INSERT OR REPLACE INTO thread_posts (id, feed_item_id, no, name, mail, date, uid, body, is_user, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const now = new Date().toISOString();
  for (const post of posts) {
    insert.run(`post:${feedItemId}:${post.no}`, feedItemId, post.no, post.name, post.mail ?? null,
      post.date, post.id, post.body, post.isUser ? 1 : 0, now);
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

// Keep user post numbers stable and never reuse removed AI post numbers for new replies.
function saveUpdatedThreadResponsePosts(write: ThreadResponseWrite, model: string, promptHash: string, version: number): number {
  const db = getDatabase();
  const row = db.prepare("SELECT MAX(no) AS max_no FROM thread_posts WHERE feed_item_id = ?")
    .get(write.feedItemId) as { max_no: number | null };
  const startNo = Math.max(1, row.max_no ?? 1);
  if (startNo + write.posts.length > 1000) throw new Error("更新レスを保存する空きがありません（1000レス上限）。");
  const numbers = new Map(write.posts.map((post, index) => [post.no, startNo + index + 1]));
  const posts = write.posts.map((post) => ({
    ...post,
    no: numbers.get(post.no)!,
    body: post.body.replace(/>>(\d+)/g, (anchor, no: string) =>
      numbers.has(Number(no)) ? `>>${numbers.get(Number(no))}` : anchor)
  }));
  db.prepare("DELETE FROM thread_posts WHERE feed_item_id = ? AND no > 1 AND is_user = 0").run(write.feedItemId);
  insertGeneratedThreadPosts(write.feedItemId, posts);
  db.prepare(`
    INSERT OR REPLACE INTO thread_summaries
    (id, feed_item_id, model, prompt_hash, posts_json, response_count, generated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(`thread-summary:${write.feedItemId}:${promptHash}`, write.feedItemId, model, promptHash,
    JSON.stringify(posts), posts.length, new Date().toISOString());
  db.prepare("UPDATE feed_items SET generated_content_version = ? WHERE id = ?").run(version, write.feedItemId);
  return 1;
}

function runInTransaction<T>(operation: () => T): T {
  const db = getDatabase();
  db.exec("BEGIN");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // SQLite may already have rolled back the transaction after a fatal write error.
    }
    throw error;
  }
}
