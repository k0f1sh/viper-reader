import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(path.join(tmpdir(), "viper-pagination-"));
process.env.VIPER_READER_DB_PATH = path.join(directory, "test.db");
const { getDatabase } = await import("../dist/main/db/database.js");
const { listThreads, searchThreads } = await import("../dist/main/db/threadRepository.js");
const { setThreadRead, countAllUnreadArticles } = await import("../dist/main/db/threadStateRepository.js");
const db = getDatabase();
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const createdAt = "2026-01-01T00:00:00.000Z";
db.prepare("INSERT INTO feed_sources (id, title, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
  .run("rss", "RSS", "https://example.com/rss", createdAt, createdAt);
const insert = db.prepare(`INSERT INTO feed_items
  (id, feed_id, title, url, canonical_url, published_at, created_at, updated_at, read_at)
  VALUES (?, 'rss', 'pagination article', ?, ?, ?, ?, ?, ?)`);
for (let i = 0; i < 240; i++) {
  const id = `item-${String(i).padStart(3, "0")}`;
  const url = `https://example.com/${id}`;
  insert.run(id, url, url, createdAt, createdAt, createdAt, i < 100 ? createdAt : null);
}

test("ページ内の70件を読んでも残りの未読を次ページで飛ばさない", () => {
  const snapshot = Date.now() - 1000;
  for (const feedId of ["rss", null]) {
    for (const unreadOnly of [false, true]) {
      db.prepare("UPDATE feed_items SET read_at = NULL WHERE id >= 'item-100'").run();
      const first = listThreads(feedId, 0, 100, unreadOnly, "", snapshot);
      assert.equal(first.items.length, 100);
      for (const item of first.items.slice(0, 70)) setThreadRead(item.id, true);
      assert.equal(countAllUnreadArticles(), 70);
      const second = listThreads(feedId, 1, 100, unreadOnly, "", snapshot);
      const refreshedFirst = listThreads(feedId, 0, 100, unreadOnly, "", snapshot);
      assert.deepEqual(refreshedFirst.items.map((item) => item.id), first.items.map((item) => item.id));
      assert.equal(refreshedFirst.items.filter((item) => item.isRead).length, 70);
      assert.equal(second.items.filter((item) => !item.isRead).length, 40);
      assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, first.items.length + second.items.length);
      assert.equal(searchThreads(feedId, "pagination", 1, 100, unreadOnly, snapshot).items.filter((item) => !item.isRead).length, 40);
      const reset = listThreads(feedId, 0, 100, true, "", Date.now() + 1000);
      assert.equal(reset.totalCount, 70);
      assert.equal(reset.items.length, 70);
    }
  }
});

test("ページ分割の時刻には安全な整数だけを受け付ける", () => {
  for (const value of [NaN, Infinity, -1, "injection", 1.5]) {
    assert.throws(() => listThreads(null, 0, 100, false, "", value), /Invalid read-state timestamp/);
  }
});
