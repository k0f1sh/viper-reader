import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
const directory = mkdtempSync(path.join(tmpdir(), "viper-updates-"));
process.env.VIPER_READER_DB_PATH = path.join(directory, "test.db");
delete process.env.GEMINI_API_KEY;
const { getDatabase } = await import("../dist/main/db/database.js");
const { upsertFeedItems } = await import("../dist/main/db/feedItemRepository.js");
const { getThread, listThreads, listFavoriteThreads } = await import("../dist/main/db/threadRepository.js");
const { getArticleBody, getArticleSummary, saveArticleBody, saveArticleSummary } = await import("../dist/main/db/articleRepository.js");
const { saveGeneratedThreadPosts, saveThreadResponsePosts } = await import("../dist/main/db/threadPostRepository.js");
const { startThreadResponseGeneration } = await import("../dist/main/threads/openThread.js");
const db = getDatabase();
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const now = "2026-09-06T00:00:00.000Z";
const post = (no, body, isUser = false) => ({ no, name: "名無しさん", date: now, id: "test", body, isUser });
function fixture(id) {
  db.prepare("INSERT INTO feed_sources (id, title, url, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, id, `https://example.com/${id}.xml`, now, now);
  const item = { id, feedId: id, guid: id, title: "旧タイトル", url: `https://example.com/${id}`, publishedAt: now, rawSummary: "旧概要" };
  upsertFeedItems(id, [item]);
  getThread(id);
  saveThreadResponsePosts({ feedItemId: id, posts: [post(2, "旧AIレス")], contentVersion: 1 }, "test", "test");
  saveArticleBody(id, item.url, "旧本文");
  saveArticleSummary(id, "旧要約");
  return item;
}

test("同一URLの訂正は本文・要約を失効し、更新成功まで旧AIレスと書き込みを残す", () => {
  const item = fixture("same-url");
  saveGeneratedThreadPosts(item.id, [post(3, ">>2 への書き込み", true)]);
  const before = getThread(item.id);
  upsertFeedItems(item.feedId, [{ ...item, title: "訂正タイトル", rawSummary: "訂正概要" }]);
  assert.equal(getArticleBody(item.id), null);
  assert.equal(getArticleSummary(item.id), null);
  const updated = getThread(item.id);
  assert.equal(updated.contentVersion, 2);
  assert.equal(updated.generatedContentVersion, 1);
  assert.match(updated.posts[0].body, /訂正概要/);
  assert.deepEqual(updated.posts.slice(1), before.posts.slice(1));
  assert.equal(listThreads(item.feedId).items[0].contentVersion, 2);
  assert.equal(listThreads(null).items[0].contentVersion, 2);
  db.prepare("UPDATE feed_items SET is_favorite = 1 WHERE id = ?").run(item.id);
  assert.equal(listFavoriteThreads()[0].contentVersion, 2);
  saveArticleBody(item.id, item.url, "訂正本文", 2);
  saveThreadResponsePosts({ feedItemId: item.id, contentVersion: 2, posts: [post(2, "新AIレス"), post(3, ">>2 の補足")] }, "test", "test");
  const result = getThread(item.id);
  assert.equal(result.contentVersion, result.generatedContentVersion);
  assert.deepEqual(result.posts.find((p) => p.isUser), before.posts.find((p) => p.isUser));
  assert.deepEqual(result.posts.slice(-2).map((p) => [p.no, p.body]), [[4, "新AIレス"], [5, ">>4 の補足"]]);
  assert.equal(result.posts.some((p) => p.body === "旧AIレス"), false);
});

test("日時だけの変更や同一RSSの再取得では本文を失効しない", () => {
  const item = fixture("date-only");
  upsertFeedItems(item.feedId, [{ ...item, publishedAt: "2026-09-07T00:00:00.000Z" }]);
  assert.equal(getThread(item.id).contentVersion, 1);
  assert.equal(getArticleBody(item.id), "旧本文");
});

test("canonical共有元の古い本文も失効し、処理中の再訂正後に旧結果を保存しない", () => {
  const item = fixture("shared-source");
  const sibling = fixture("shared-target");
  upsertFeedItems(sibling.feedId, [{ ...sibling, url: item.url }]);
  saveArticleBody(item.id, item.url, "共有本文");
  assert.equal(getArticleBody(sibling.id), "共有本文");
  const snapshot = getThread(sibling.id);
  upsertFeedItems(item.feedId, [{ ...item, rawSummary: "再訂正概要" }]);
  assert.equal(getArticleBody(sibling.id), null);
  assert.throws(() => saveArticleBody(sibling.id, item.url, "古い取得結果", snapshot.contentVersion), /記事が更新/);
  const before = getThread(sibling.id);
  assert.throws(() => saveThreadResponsePosts({ feedItemId: sibling.id, contentVersion: snapshot.contentVersion, posts: [post(2, "古い生成結果")] }, "test", "test"), /記事が更新/);
  assert.deepEqual(getThread(sibling.id), before);
});

test("更新生成の保存失敗は旧レス・書き込み・版をロールバックする", () => {
  const item = fixture("rollback");
  upsertFeedItems(item.feedId, [{ ...item, rawSummary: "訂正概要" }]);
  const before = getThread(item.id);
  db.exec(`CREATE TEMP TRIGGER fail_updated_post BEFORE INSERT ON thread_posts WHEN NEW.body = '保存失敗' BEGIN SELECT RAISE(ABORT, 'injected'); END`);
  try {
    assert.throws(() => saveThreadResponsePosts({ feedItemId: item.id, contentVersion: 2, posts: [post(2, "保存失敗")] }, "test", "test"), /injected/);
    assert.deepEqual(getThread(item.id), before);
  } finally { db.exec("DROP TRIGGER fail_updated_post"); }
});

test("訂正済みスレッドは既存レスがあっても通常生成をスキップしない", async () => {
  const item = fixture("regenerate-update");
  upsertFeedItems(item.feedId, [{ ...item, rawSummary: "訂正概要" }]);
  saveArticleBody(item.id, item.url, "訂正本文", 2);
  const stages = [];
  const result = await new Promise((resolve) => startThreadResponseGeneration(item.id, false, resolve, (event) => stages.push(event.stage)));
  assert.equal(result, "error"); // API key absent; old posts must survive.
  assert.ok(stages.includes("generating-posts"));
  assert.equal(stages.includes("fetching-article"), false);
  assert.equal(getThread(item.id).generatedContentVersion, 1);
  assert.equal(getThread(item.id).posts[1].body, "旧AIレス");
});


test("置き換えで既読末尾のAIレスが消えても未読線を残す", () => {
  const item = fixture("updated-read-marker");
  db.prepare("UPDATE feed_items SET read_at = ?, last_read_post_no = 2 WHERE id = ?").run(now, item.id);
  upsertFeedItems(item.feedId, [{ ...item, rawSummary: "訂正" }]);
  saveThreadResponsePosts({ feedItemId: item.id, contentVersion: 2, posts: [post(2, "訂正AIレス")] }, "test", "test");
  const thread = getThread(item.id);
  assert.deepEqual(thread.posts.map((post) => post.no), [1, 3]);
  assert.equal(thread.readMarkerNo, 1);
});
