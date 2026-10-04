import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(path.join(tmpdir(), "viper-content-deletion-"));
process.env.VIPER_READER_DB_PATH = path.join(directory, "test.db");
delete process.env.GEMINI_API_KEY;
const { getDatabase } = await import("../dist/main/db/database.js");
const { getThread } = await import("../dist/main/db/threadRepository.js");
const { getArticleBody, saveArticleBody } = await import("../dist/main/db/articleRepository.js");
const { deleteThreadContent } = await import("../dist/main/db/threadContentRepository.js");
const db = getDatabase();
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test("deletes cached body and all replies while retaining the RSS post and article", () => {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO feed_sources (id, title, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("feed", "Feed", "https://example.com/feed", now, now);
  for (const id of ["first", "sibling"]) {
    db.prepare(`INSERT INTO feed_items
      (id, feed_id, title, url, canonical_url, raw_summary, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, "feed", id, `https://example.com/${id}`, "https://example.com/article", "RSS body", now, now);
    getThread(id);
  }
  saveArticleBody("sibling", "https://example.com/article", "Fetched body");
  db.prepare(`INSERT INTO thread_summaries
    (id, feed_item_id, model, prompt_hash, posts_json, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run("summary", "first", "model", "hash", "[]", now);
  for (const [no, isUser] of [[2, 0], [3, 1]]) {
    db.prepare(`INSERT INTO thread_posts
      (id, feed_item_id, no, name, date, uid, body, is_user, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(`post-${no}`, "first", no, "name", now, "uid", `reply ${no}`, isUser, now);
  }
  db.prepare(`UPDATE feed_items SET generation_status = 'completed', last_read_post_no = 3 WHERE id = 'first'`).run();

  deleteThreadContent("first");

  assert.equal(getArticleBody("first"), null);
  assert.equal(getArticleBody("sibling"), null);
  assert.deepEqual(getThread("first").posts.map((post) => post.no), [1]);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM thread_summaries WHERE feed_item_id = 'first'").get().count, 0);
  assert.deepEqual({ ...db.prepare("SELECT generation_status, last_read_post_no, latest_post_no FROM feed_items WHERE id = 'first'").get() },
    { generation_status: null, last_read_post_no: 1, latest_post_no: 1 });
  assert.equal(getThread("sibling").posts.length, 1);
});
