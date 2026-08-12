import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const testDirectory = mkdtempSync(path.join(tmpdir(), "viper-reader-feed-order-test-"));
process.env.VIPER_READER_DB_PATH = path.join(testDirectory, "test.db");

const { getDatabase } = await import("../dist/main/db/database.js");
const {
  addFeedSource,
  listFeeds,
  reorderFeedSources,
  updateFeedSettings
} = await import("../dist/main/db/repository.js");

const db = getDatabase();

after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

test("板一覧の並び順をSQLiteへ保存する", () => {
  const first = addFeedSource("1番目", "https://example.com/first.xml");
  const second = addFeedSource("2番目", "https://example.com/second.xml");
  const third = addFeedSource("3番目", "https://example.com/third.xml");

  reorderFeedSources([third.id, first.id, second.id]);

  assert.deepEqual(listFeeds().map((feed) => feed.id), [third.id, first.id, second.id]);
});

test("一部の板だけを指定した不正な並び順は保存しない", () => {
  const currentOrder = listFeeds().map((feed) => feed.id);

  assert.throws(() => reorderFeedSources(currentOrder.slice(1)), /並び順が不正/);
  assert.deepEqual(listFeeds().map((feed) => feed.id), currentOrder);
});

test("板の設定からタイトルとスレタイ生成方法を更新できる", () => {
  const feed = listFeeds()[0];
  const updated = updateFeedSettings(feed.id, "  新しい板タイトル  ", true, true, true);

  assert.equal(updated.title, "新しい板タイトル");
  assert.equal(updated.generateTitleFromSummary, true);
  assert.equal(updated.skipTitleConversion, true);
  assert.equal(updated.defaultToArticleBrowser, true);
  assert.equal(listFeeds().find((candidate) => candidate.id === feed.id)?.title, "新しい板タイトル");
});
