import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(path.join(tmpdir(), "viper-search-"));
process.env.VIPER_READER_DB_PATH = path.join(directory, "test.db");
delete process.env.GEMINI_API_KEY;

const { getDatabase } = await import("../dist/main/db/database.js");
const { searchThreads } = await import("../dist/main/db/threadRepository.js");
const db = getDatabase();
const now = "2026-09-29T00:00:00.000Z";

after(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

function feed(id) {
  db.prepare("INSERT INTO feed_sources (id, title, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, id, `https://example.com/${id}.xml`, now, now);
}

function item(id, feedId, title, summary, url = `https://example.com/${id}`) {
  db.prepare(`
    INSERT INTO feed_items (id, feed_id, title, url, canonical_url, raw_summary, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, feedId, title, url, url, summary, now, now, now);
}

feed("a");
feed("b");
item("body-a", "a", "Switching editors", "A Neovim story", "https://example.com/shared");
item("body-b", "b", "Switching editors", "A Neovim story", "https://example.com/shared");
item("title", "a", "DOOM EMACS setup", "No summary match");
item("summary", "a", "Config notes", "Doom Emacs appears here");
item("converted", "a", "Original title", "No summary match");
item("literal", "a", "100%_done", "No summary match");
item("duplicate-a", "a", "Hidden phrase", "No summary match", "https://example.com/duplicate");
item("duplicate-z", "b", "Other title", "No summary match", "https://example.com/duplicate");
db.prepare("INSERT INTO article_bodies (id, feed_item_id, url, content_text, content_hash, fetched_at) VALUES (?, ?, ?, ?, ?, ?)")
  .run("article-body", "body-a", "https://example.com/shared", "Why I Went With Doom Emacs", "hash", now);
db.prepare("INSERT INTO thread_titles (id, feed_item_id, model, prompt_hash, title, generated_at) VALUES (?, ?, ?, ?, ?, ?)")
  .run("thread-title", "converted", "test", "test", "Doom Emacs conversion", now);

test("保存済み本文・元タイトル・概要・変換スレタイを大小文字を区別せず検索する", () => {
  const results = searchThreads("a", "doom emacs");
  assert.deepEqual(new Set(results.items.map((item) => item.id)), new Set(["body-a", "title", "summary", "converted"]));
  assert.equal(results.totalCount, 4);
});

test("板を限定し、全板では同じ記事をまとめる", () => {
  assert.deepEqual(searchThreads("b", "Doom Emacs").items.map((item) => item.id), ["body-b"]);
  const all = searchThreads(null, "Doom Emacs");
  assert.equal(all.totalCount, 4);
  assert.equal(all.items.filter((item) => item.url === "https://example.com/shared").length, 1);
  const titleOnlyOnDuplicate = searchThreads(null, "Hidden phrase");
  assert.equal(titleOnlyOnDuplicate.totalCount, 1);
  assert.equal(titleOnlyOnDuplicate.items.length, 1);
});

test("LIKE の特殊文字を文字どおりに扱い、ページ数を返す", () => {
  assert.deepEqual(searchThreads("a", "%_").items.map((item) => item.id), ["literal"]);
  assert.equal(searchThreads("a", "no such phrase").totalCount, 0);
  const first = searchThreads("a", "Doom Emacs", 0, 2);
  const second = searchThreads("a", "Doom Emacs", 1, 2);
  assert.equal(first.totalCount, 4);
  assert.equal(first.items.length, 2);
  assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 4);
});
