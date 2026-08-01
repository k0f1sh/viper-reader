import type { ReplyGenerationRun, ReplyRating, ThreadPost } from "../../shared/types.js";
import { createInitialPosts } from "../threads/initialThreadPosts.js";
import { getDatabase } from "./database.js";

export type ThreadResponseWrite = {
  feedItemId: string;
  posts: ThreadPost[];
};

export function listReplyGenerationRuns(threadId: string): ReplyGenerationRun[] {
  const rows = getDatabase().prepare(`
    SELECT r.id, r.feed_item_id, r.start_no, r.end_no, r.mode, r.prompt_version_id,
           f.rating, f.tags_json
    FROM reply_generation_runs r
    LEFT JOIN reply_feedback f ON f.run_id = r.id
    WHERE r.feed_item_id = ? AND r.status = 'success'
    ORDER BY r.start_no
  `).all(threadId) as Array<{
    id: string;
    feed_item_id: string;
    start_no: number;
    end_no: number;
    mode: ReplyGenerationRun["mode"];
    prompt_version_id: string | null;
    rating: ReplyRating | null;
    tags_json: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    threadId: row.feed_item_id,
    startNo: row.start_no,
    endNo: row.end_no,
    mode: row.mode,
    promptVersionId: row.prompt_version_id,
    rating: row.rating,
    feedbackTags: row.tags_json ? JSON.parse(row.tags_json) as string[] : []
  }));
}

export function recordReplyGenerationRun(params: {
  id: string;
  feedId: string;
  threadId: string;
  mode: string;
  model: string;
  promptVersionId: string | null;
  promptHash: string;
  startNo: number;
  endNo: number;
}): void {
  const db = getDatabase();
  db.prepare(`
    INSERT INTO reply_generation_runs
    (id, feed_id, feed_item_id, mode, model, prompt_version_id, prompt_hash, start_no, end_no, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'success', ?)
  `).run(params.id, params.feedId, params.threadId, params.mode, params.model, params.promptVersionId,
    params.promptHash, params.startNo, params.endNo, new Date().toISOString());
  db.prepare("UPDATE thread_posts SET generation_run_id = ? WHERE feed_item_id = ? AND no BETWEEN ? AND ?")
    .run(params.id, params.threadId, params.startNo, params.endNo);
  db.prepare(`
    UPDATE thread_posts
    SET resident_id = (SELECT id FROM feed_residents WHERE feed_id = ? AND stable_uid = thread_posts.uid LIMIT 1)
    WHERE feed_item_id = ? AND no BETWEEN ? AND ?
  `).run(params.feedId, params.threadId, params.startNo, params.endNo);
}

export function markLatestReplyRunContinued(threadId: string, kind: "user" | "thread"): void {
  const column = kind === "user" ? "user_continued_at" : "continued_thread_at";
  getDatabase().prepare(`UPDATE reply_generation_runs SET ${column} = ? WHERE id = (
    SELECT id FROM reply_generation_runs WHERE feed_item_id = ? ORDER BY created_at DESC LIMIT 1
  )`).run(new Date().toISOString(), threadId);
}

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
