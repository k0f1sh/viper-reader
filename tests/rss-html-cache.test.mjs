import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(path.join(tmpdir(), "viper-rss-html-"));
process.env.VIPER_READER_DB_PATH = path.join(directory, "test.db");
const { getDatabase } = await import("../dist/main/db/database.js");
const { upsertFeedItems } = await import("../dist/main/db/feedItemRepository.js");
const { getThread } = await import("../dist/main/db/threadRepository.js");
const db = getDatabase();
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test("cached raw RSS HTML is sanitized for both initial and persisted post 1", () => {
  const now = "2026-10-03T00:00:00.000Z";
  db.prepare("INSERT INTO feed_sources (id, title, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run("html", "HTML", "https://example.com/rss", now, now);
  const item = { id: "html-item", feedId: "html", guid: "html-item", title: "<img src=x>", url: "https://example.com/article", publishedAt: now, rawSummary: "Comments" };
  upsertFeedItems("html", [item]);
  assert.equal(getThread(item.id).posts[0].rssContent, undefined);
  const rawSummaryHtml = '<p onclick="alert(1)"><a href="https://news.ycombinator.com/item?id=123">Comments</a><img src="https://tracker.example"></p>';
  const version = getThread(item.id).contentVersion;
  upsertFeedItems("html", [{ ...item, rawSummaryHtml }]);
  assert.equal(db.prepare("SELECT raw_summary_html FROM feed_items WHERE id = ?").get(item.id).raw_summary_html, rawSummaryHtml);
  for (let index = 0; index < 2; index++) {
    const thread = getThread(item.id);
    assert.equal(thread.contentVersion, version);
    assert.match(thread.posts[0].rssContent.header, /元記事タイトル:\n<img src=x>/);
    assert.equal(thread.posts[0].rssContent.html, '<p><a href="https://news.ycombinator.com/item?id=123">Comments</a></p>');
    assert.match(thread.posts[0].body, /Comments/);
  }
  db.prepare("DELETE FROM thread_posts WHERE feed_item_id = ?").run(item.id);
  assert.match(getThread(item.id).posts[0].rssContent.html, />Comments<\/a>/);
  upsertFeedItems("html", [{ ...item, rawSummaryHtml: null }]);
  assert.equal(getThread(item.id).posts[0].rssContent, undefined);
});
