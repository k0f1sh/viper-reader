import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(path.join(tmpdir(), "viper-likes-"));
process.env.VIPER_READER_DB_PATH = path.join(directory, "test.db");
const { getDatabase } = await import("../dist/main/db/database.js");
const { listLikedThreads, listFavoriteThreads } = await import("../dist/main/db/threadRepository.js");
const { setThreadLiked } = await import("../dist/main/db/threadStateRepository.js");
const db = getDatabase();
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

test("liked threads include local and RSS threads, paginate by like date, and remain independent of favorites", () => {
  const now = new Date().toISOString();
  for (const kind of ["rss", "local"]) {
    db.prepare("INSERT INTO feed_sources (id, title, url, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(kind, kind, `https://example.com/${kind}`, kind, now, now);
    db.prepare("INSERT INTO feed_items (id, feed_id, title, url, raw_summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(kind, kind, kind, `https://example.com/article/${kind}`, "body", now, now);
  }
  assert.equal(listLikedThreads().totalCount, 0);
  const likedAt = setThreadLiked("rss", true);
  assert.equal(setThreadLiked("rss", true), likedAt);
  setThreadLiked("local", true);
  db.prepare("UPDATE feed_items SET liked_at = '2000-01-01T00:00:00.000Z' WHERE id = 'rss'").run();
  assert.equal(listLikedThreads(0, 1).items[0].id, "local");
  assert.equal(listLikedThreads(1, 1).items[0].id, "rss");
  assert.equal(listLikedThreads().totalCount, 2);
  assert.equal(listFavoriteThreads().length, 0);
  assert.equal(setThreadLiked("rss", false), null);
  const page = listLikedThreads(1, 1);
  assert.equal(page.page, 0);
  assert.equal(page.totalCount, 1);
  assert.equal(page.items[0].id, "local");
  setThreadLiked("local", false);
  assert.deepEqual(listLikedThreads().items, []);
});
