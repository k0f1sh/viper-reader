import { isRssBoard, isLocalBoard } from "../dist/shared/boardPolicy.js";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promises as dns } from "node:dns";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";

const directory = mkdtempSync(path.join(tmpdir(), "viper-local-board-"));
process.env.VIPER_READER_DB_PATH = path.join(directory, "test.db");
delete process.env.GEMINI_API_KEY;
const { getDatabase } = await import("../dist/main/db/database.js");
const { localBoardId } = await import("../dist/shared/types.js");
const { createLocalThread } = await import("../dist/main/threads/createLocalThread.js");
const { getThread, listThreads, searchThreads, listFavoriteThreads, listGeneratedQueue, getReadingQueueSummary } = await import("../dist/main/db/threadRepository.js");
const { getArticleBody, getArticleSummary, saveArticleBody, saveArticleSummary } = await import("../dist/main/db/articleRepository.js");
const { listFeeds, addFeedSource, deleteFeedSource, updateFeedSettings, markAllFeedsRead } = await import("../dist/main/db/feedRepository.js");
const { setThreadFavorite, markThreadPostsRead, countAllUnreadArticles } = await import("../dist/main/db/threadStateRepository.js");
const { saveGeneratedThreadPosts } = await import("../dist/main/db/threadPostRepository.js");
const { saveFeedResidentPrompt } = await import("../dist/main/db/residentPromptRepository.js");
const { saveFeedTreeLayout } = await import("../dist/main/db/feedFolderRepository.js");
const { generateRepliesOnly, postThreadMessage } = await import("../dist/main/threads/postMessage.js");
const { acquireThreadLock, releaseThreadLock } = await import("../dist/main/threads/threadLocks.js");
const { startThreadResponseGeneration } = await import("../dist/main/threads/openThread.js");
const { regenerateThreadTitle } = await import("../dist/main/threads/regenerateThreadTitle.js");
const { deleteThreadContent } = await import("../dist/main/db/threadContentRepository.js");
const { refreshFeed } = await import("../dist/main/rss/refreshFeed.js");
const db = getDatabase();
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
const textRequest = (title = "手入力スレ") => ({ mode: "text", title, body: "記事本文の相談です。\n元記事と記事内容という言葉もそのまま残す。" });
const post = (no) => ({ no, name: "名無しさん", mail: "sage", date: "2026/10/02(金) 12:00:00.00", id: "AbCd1234", body: `>>1\n返信${no}` });

function network(t, replyText = "記事の要点をまとめた要約です。") {
  const calls = [];
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    const body = options?.body ?? (input instanceof Request ? await input.clone().text() : "");
    calls.push({ url, body });
    if (url.includes("generativelanguage.googleapis.com")) {
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: typeof replyText === "function" ? replyText(JSON.parse(body)) : JSON.parse(body).generationConfig?.responseMimeType === "application/json" && !replyText.startsWith("[") ? JSON.stringify([{ ...post(2), body: "ちょｗｗ要点はこういう話だぞ。" }]) : replyText }] }, finishReason: "STOP" }] });
    }
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
    return new Response('<html><head><title>Article</title></head><body><article><h1>記事タイトル</h1><p>URLから取得した記事本文です。技術について具体的に説明します。</p></article></body></html>');
  });
  return calls;
}

test("自由板は再起動しても重複せずRSS板の種別を保持する", () => {
  const feed = addFeedSource("RSS", "https://rss-local.example/feed.xml");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const { getDatabase } = await import('./dist/main/db/database.js');
    const db = getDatabase();
    if (db.prepare("SELECT COUNT(*) AS n FROM feed_sources WHERE kind = 'local'").get().n !== 1) process.exit(1);
    db.close();
  `], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(listFeeds().find((item) => item.id === feed.id).kind, "rss");
  assert.equal(listFeeds().filter(isLocalBoard).length, 1);
});

test("直接入力は通信なしで本文をレス1に保存し、一覧・検索・お気に入りに使える", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () => { throw new Error("通信禁止"); });
  const { thread, warning } = await createLocalThread(textRequest());
  assert.equal(warning, null);
  assert.equal(thread.kind, "local");
  assert.equal(thread.url, "");
  assert.equal(thread.threadTitle, "手入力スレ");
  assert.equal(thread.posts.length, 1);
  assert.equal(thread.posts[0].no, 1);
  assert.equal(thread.posts[0].isUser, true);
  assert.equal(thread.posts[0].body, textRequest().body);
  assert.equal(getArticleBody(thread.id), textRequest().body);
  assert.equal(getThread(thread.id).posts[0].body, textRequest().body);
  assert.ok(listThreads(localBoardId).items.some((item) => item.id === thread.id));
  assert.ok(searchThreads(localBoardId, "記事内容").items.some((item) => item.id === thread.id));
  setThreadFavorite(thread.id, true);
  assert.ok(listFavoriteThreads().some((item) => item.id === thread.id && isLocalBoard(item)));
  assert.equal(fetch.mock.calls.length, 0);
});

test("自由板はRSS全体・未読・生成キューと件数から分離し全板既読の影響も受けない", async () => {
  const { thread } = await createLocalThread(textRequest("分離するスレ"));
  const summary = getReadingQueueSummary();
  db.prepare("UPDATE feed_items SET generation_status = 'completed' WHERE id = ?").run(thread.id);
  saveGeneratedThreadPosts(thread.id, [post(2)]);
  assert.equal(countAllUnreadArticles(), 0);
  assert.equal(listThreads(null).totalCount, 0);
  assert.equal(listThreads(null, 0, 100, true).totalCount, 0);
  assert.equal(listGeneratedQueue().totalCount, 0);
  assert.equal(listGeneratedQueue(0, 100, true).totalCount, 0);
  assert.deepEqual(getReadingQueueSummary(), summary);
  markAllFeedsRead();
  assert.equal(getThread(thread.id).isRead, false);
  markThreadPostsRead(thread.id, 2);
  assert.equal(getThread(thread.id).isRead, true);
});

test("入力の型・必須項目・文字数・URL方式をMainで検証する", async () => {
  const before = db.prepare("SELECT COUNT(*) AS n FROM feed_items").get().n;
  for (const input of [null, {}, { ...textRequest(), mode: "other" }, { ...textRequest(), title: " " },
    { ...textRequest(), title: "a".repeat(201) }, { ...textRequest(), body: " " },
    { ...textRequest(), body: "a".repeat(10001) }, { mode: "url", title: "URL", url: "file:///tmp/a" },
    { mode: "url", title: "URL", url: "https://user:pass@example.com" }]) {
    await assert.rejects(createLocalThread(input));
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM feed_items").get().n, before);
});

test("URL指定は要約を保存してから通常の生成処理で住民のレス2だけを作る", async (t) => {
  process.env.GEMINI_API_KEY = "local-test-key";
  t.after(() => { delete process.env.GEMINI_API_KEY; });
  const calls = network(t);
  const { thread, warning } = await createLocalThread({ mode: "url", title: "URLスレ", url: "https://fresh-local.example/article?utm_source=test#part" });
  assert.equal(warning, null);
  assert.equal(thread.url, "https://fresh-local.example/article");
  assert.equal(thread.posts[0].body, "元記事タイトル:\nURLスレ\n\nURL:\nhttps://fresh-local.example/article");
  assert.equal(thread.posts[0].isUser, true);
  assert.equal(thread.posts[1].no, 2);
  assert.equal(thread.posts[1].body, "ちょｗｗ要点はこういう話だぞ。");
  assert.equal(thread.posts[1].isUser, false);
  assert.match(getArticleBody(thread.id), /URLから取得した記事本文/);
  assert.equal(thread.posts.length, 2);
  assert.equal(getArticleSummary(thread.id), "記事の要点をまとめた要約です。");
  assert.equal(calls.filter((call) => call.url.includes("generativelanguage")).length, 2);
  const speech = JSON.parse(calls.filter((call) => call.url.includes("generativelanguage"))[1].body);
  const prompt = speech.contents.flatMap((content) => content.parts.map((part) => part.text ?? "")).join("\n");
  assert.match(prompt, /【記事要約】\n記事の要点をまとめた要約です。/);
  assert.match(prompt, /事情通の掲示板の住民/);
  assert.match(prompt, /情報整理レスだけを1件/);
  assert.equal(calls.filter((call) => call.url.includes("fresh-local.example")).length, 2);
});

test("同じURLの本文・要約を再利用し、要約レスだけを生成して別スレに保存する", async (t) => {
  const feed = listFeeds().find(isRssBoard);
  const now = new Date().toISOString();
  const url = "https://cached-local.example/article";
  db.prepare("INSERT INTO feed_items (id, feed_id, title, url, canonical_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run("cached-rss-item", feed.id, "Cached", url, url, now, now);
  saveArticleBody("cached-rss-item", url, "保存済み本文");
  saveArticleSummary("cached-rss-item", "保存済み要約");
  process.env.GEMINI_API_KEY = "local-test-key";
  t.after(() => { delete process.env.GEMINI_API_KEY; });
  const calls = network(t);
  const first = await createLocalThread({ mode: "url", title: "キャッシュスレ", url });
  const second = await createLocalThread({ mode: "url", title: "同じURLの別スレ", url });
  assert.notEqual(first.thread.id, second.thread.id);
  assert.equal(getArticleBody(first.thread.id), "保存済み本文");
  assert.equal(getArticleSummary(second.thread.id), "保存済み要約");
  assert.equal(first.thread.posts[1].body, "ちょｗｗ要点はこういう話だぞ。");
  assert.equal(second.thread.posts[1].body, "ちょｗｗ要点はこういう話だぞ。");
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.url.includes("generativelanguage")));
  markThreadPostsRead(first.thread.id, 1);
  assert.equal(getThread(second.thread.id).isRead, false);
  assert.equal(getThread("cached-rss-item").isRead, false);
});

test("記事取得失敗ではスレを作らず、要約失敗では本文を保持して警告を返す", async (t) => {
  const before = listThreads(localBoardId).totalCount;
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response("User-agent: *\nDisallow: /"));
  await assert.rejects(createLocalThread({ mode: "url", title: "取得失敗", url: "https://blocked-local.example/article" }), /取得できません/);
  assert.equal(listThreads(localBoardId).totalCount, before);
  fetch.mock.restore();
  network(t);
  const { thread, warning } = await createLocalThread({ mode: "url", title: "キー未設定", url: "https://nokey-local.example/article" });
  assert.match(warning, /要約できません/);
  assert.ok(getArticleBody(thread.id));
  assert.equal(thread.posts.length, 2);
  assert.match(thread.posts[1].body, /要約はまだできてない/);
  assert.equal(thread.posts[1].isUser, false);
});

test("明示的な返信生成は住民設定・元の本文を使い、スレ立て時の投稿を保持する", async (t) => {
  const { thread } = await createLocalThread(textRequest("会話スレ"));
  saveFeedResidentPrompt(localBoardId, "短く親しみやすく答える住民");
  process.env.GEMINI_API_KEY = "local-test-key";
  t.after(() => { delete process.env.GEMINI_API_KEY; });
  const calls = network(t, JSON.stringify([post(2), post(3)]));
  const result = await generateRepliesOnly(thread.id);
  assert.deepEqual(result.posts.map((post) => post.no), [1, 2, 3]);
  assert.equal(result.posts[0].body, textRequest().body);
  const request = JSON.parse(calls[0].body);
  const prompt = request.contents.flatMap((content) => content.parts.map((part) => part.text ?? "")).join("\n");
  assert.match(prompt, /短く親しみやすく答える住民/);
  assert.ok(prompt.includes(textRequest().body));
  assert.match(prompt, /検証済みの事実ではありません/);
  assert.equal(calls.length, 1);
});

test("返信失敗でも追加投稿を残し、処理中の二重投稿と1000レス以降を拒否する", async () => {
  const { thread } = await createLocalThread(textRequest("失敗後も残るスレ"));
  let resolveStatus;
  const finished = new Promise((resolve) => { resolveStatus = resolve; });
  await postThreadMessage(thread.id, "", "", "追加の質問", (status) => { if (status === "error") resolveStatus(); });
  await finished;
  assert.equal(getThread(thread.id).posts[1].body, "追加の質問");
  acquireThreadLock(thread.id);
  await assert.rejects(postThreadMessage(thread.id, "", "", "重複"), /現在処理中/);
  releaseThreadLock(thread.id);
  saveGeneratedThreadPosts(thread.id, [post(1000)]);
  await assert.rejects(generateRepliesOnly(thread.id), /1000レス/);
  await assert.rejects(postThreadMessage(thread.id, "", "", "限界"), /1000レス/);
});

test("自由板のRSS更新・タイトル変換・削除・移動をMain側で拒否する", async () => {
  const { thread } = await createLocalThread(textRequest("保護するスレ"));
  assert.throws(() => deleteFeedSource(localBoardId), /自由板/);
  assert.throws(() => updateFeedSettings(localBoardId, "変更", false, false, false), /自由板/);
  assert.throws(() => deleteThreadContent(thread.id), /自由板/);
  assert.throws(() => startThreadResponseGeneration(thread.id, false, () => {}), /自由板/);
  await assert.rejects(regenerateThreadTitle(thread.id), /スレタイ変換しない/);
  await assert.rejects(refreshFeed(localBoardId, () => {}), /自由板/);
  assert.throws(() => saveFeedTreeLayout(listFeeds().map((feed) => ({ type: "feed", id: feed.id, parentFolderId: null }))), /配置が不正/);
  assert.equal(getThread(thread.id).posts.length, 1);
});

test("旧SQLiteスキーマのRSS記事とレスを保持して自由板を追加する", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { schemaSql } = await import("../dist/main/db/schema.js");
  const oldPath = path.join(directory, "old.db");
  const old = new DatabaseSync(oldPath);
  old.exec(schemaSql.replace("  kind TEXT NOT NULL DEFAULT 'rss' CHECK (kind IN ('rss', 'local')),\n", "").replace("  source_url TEXT,\n", ""));
  const now = new Date().toISOString();
  old.prepare("INSERT INTO feed_sources (id, title, url, created_at, updated_at) VALUES ('old-feed', '旧RSS', 'https://old.example/feed', ?, ?)").run(now, now);
  old.prepare("INSERT INTO feed_items (id, feed_id, title, url, created_at, updated_at) VALUES ('old-thread', 'old-feed', '旧タイトル', 'https://old.example/article', ?, ?)").run(now, now);
  old.prepare("INSERT INTO thread_posts (id, feed_item_id, no, name, date, uid, body, is_user, created_at) VALUES ('old-post', 'old-thread', 1, '名無しさん', ?, 'AbCd1234', '旧本文', 1, ?)").run(now, now);
  old.close();
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from 'node:assert/strict';
    const { getDatabase } = await import('./dist/main/db/database.js');
    const { getThread } = await import('./dist/main/db/threadRepository.js');
    const db = getDatabase();
    assert.equal(getThread('old-thread').kind, 'rss');
    assert.equal(getThread('old-thread').posts[0].body, '旧本文');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM feed_sources WHERE kind = 'local'").get().n, 1);
    db.close();
  `], { cwd: process.cwd(), env: { ...process.env, VIPER_READER_DB_PATH: oldPath }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});


test("RSS更新後に自由板の本文を古いRSSキャッシュとして再利用しない", async () => {
  const { upsertFeedItems } = await import("../dist/main/db/feedItemRepository.js");
  const feed = addFeedSource("更新テストRSS", "https://isolated-cache.example/feed.xml");
  const item = { id: "isolated-rss", feedId: feed.id, guid: "article", title: "更新前",
    url: "https://isolated-cache.example/article", publishedAt: new Date().toISOString(), rawSummary: "旧概要" };
  upsertFeedItems(feed.id, [item]);
  saveArticleBody(item.id, item.url, "保存時点の本文");
  saveArticleSummary(item.id, "保存時点の要約");
  const { thread } = await createLocalThread({ mode: "url", title: "独立した会話", url: item.url });
  upsertFeedItems(feed.id, [{ ...item, title: "更新後", rawSummary: "新概要" }]);
  assert.equal(getArticleBody(item.id), null);
  assert.equal(getArticleSummary(item.id), null);
  assert.equal(getArticleBody(thread.id), "保存時点の本文");
  assert.equal(getArticleSummary(thread.id), "保存時点の要約");
});


test("URL要約の再試行はレス2を更新し、住民の返信はレス3以降に続く", async (t) => {
  const { thread } = await createLocalThread({ mode: "url", title: "要約を再試行", url: "https://nokey-local.example/article" });
  assert.match(thread.posts[1].body, /要約はまだできてない/);
  const firstBody = thread.posts[0].body;
  const summaryUid = thread.posts[1].id;
  process.env.GEMINI_API_KEY = "local-test-key";
  t.after(() => { delete process.env.GEMINI_API_KEY; });
  const calls = network(t, (request) => request.generationConfig?.responseMimeType === "application/json"
    ? JSON.stringify(request.contents.some((content) => content.parts.some((part) => part.text?.includes("# 今回の生成範囲")))
      ? [{ ...post(2), body: "要約読んだｗｗこういうことだぞ。" }] : [post(3), post(4)]) : "再試行した記事要約");
  const result = await generateRepliesOnly(thread.id);
  assert.deepEqual(result.posts.map((post) => post.no), [1, 2, 3, 4]);
  assert.equal(result.posts[0].body, firstBody);
  assert.equal(result.posts[1].body, "要約読んだｗｗこういうことだぞ。");
  assert.equal(result.posts[1].id, summaryUid);
  assert.equal(result.posts[1].isUser, false);
  assert.equal(calls.length, 3);
  const replyRequest = JSON.parse(calls[2].body);
  const prompt = replyRequest.contents.flatMap((content) => content.parts.map((part) => part.text ?? "")).join("\n");
  assert.ok(prompt.includes(result.posts[1].body));
  assert.ok(!prompt.includes("要約はまだできてない"));
  const again = await generateRepliesOnly(thread.id);
  assert.deepEqual(again.posts.map((post) => post.no), [1, 2, 3, 4, 5, 6]);
  assert.equal(again.posts[1].body, result.posts[1].body);
  assert.equal(calls.length, 4);
});

test("既存の会話のレス2を要約で上書きしない", async () => {
  const { saveLocalArticleSummaryPost } = await import("../dist/main/threads/localArticleSummaryPost.js");
  const { postUserMessage } = await import("../dist/main/db/threadPostRepository.js");
  const { thread } = await createLocalThread({ mode: "url", title: "既存レスを保護", url: "https://cached-local.example/article" });
  const params = { feedItemId: thread.id, no: 2, name: "名無しさん", mail: null,
    date: thread.posts[0].date, uid: "User1234", body: "既存の質問" };
  postUserMessage(params);
  saveLocalArticleSummaryPost(thread.id, "新しい要約");
  assert.equal(getThread(thread.id).posts[1].body, params.body);
  assert.equal(getThread(thread.id).posts[1].isUser, true);
  saveGeneratedThreadPosts(thread.id, [post(2)]);
  saveLocalArticleSummaryPost(thread.id, "新しい要約");
  assert.equal(getThread(thread.id).posts[1].body, post(2).body);
});


test("要約レス生成の失敗後は保存済み要約を使って再試行し、成功したレス2を再生成しない", async (t) => {
  const { ensureLocalArticleSummaryPost } = await import("../dist/main/threads/localArticleSummaryPost.js");
  process.env.GEMINI_API_KEY = "local-test-key";
  t.after(() => { delete process.env.GEMINI_API_KEY; });
  const calls = network(t, (request) => request.generationConfig?.responseMimeType === "application/json" ? "[]" : "保存できた内部要約");
  const { thread, warning } = await createLocalThread({ mode: "url", title: "要約レスだけ再試行", url: "https://speech-retry.example/article" });
  assert.match(warning, /要約レスを生成できません/);
  assert.equal(getArticleSummary(thread.id), "保存できた内部要約");
  assert.match(thread.posts[1].body, /要約はまだできてない/);
  assert.equal(calls.filter((call) => call.url.includes("generativelanguage")).length, 2);
  const retries = network(t);
  await ensureLocalArticleSummaryPost(thread.id);
  assert.equal(getThread(thread.id).posts[1].body, "ちょｗｗ要点はこういう話だぞ。");
  assert.equal(retries.length, 1);
  const request = JSON.parse(retries[0].body);
  const prompt = request.contents.flatMap((content) => content.parts.map((part) => part.text ?? "")).join("\n");
  assert.match(prompt, /保存できた内部要約/);
  assert.match(prompt, /短く親しみやすく答える住民/);
  await ensureLocalArticleSummaryPost(thread.id);
  assert.equal(retries.length, 1);
  assert.equal(getThread(thread.id).posts.length, 2);
});

test("自由スレを全レス・本文ごと物理削除し、同じURLのRSS記事と別スレ・自由板を残す", async () => {
  const { deleteLocalThread } = await import("../dist/main/threads/deleteLocalThread.js");
  const url = "https://cached-local.example/article";
  const { thread } = await createLocalThread({ mode: "url", title: "削除する自由スレ", url });
  const { thread: other } = await createLocalThread({ mode: "url", title: "残す自由スレ", url });
  const { thread: text } = await createLocalThread(textRequest("削除する本文スレ"));
  saveGeneratedThreadPosts(thread.id, [post(3)]);
  setThreadFavorite(thread.id, true);
  const rssBody = getArticleBody("cached-rss-item");
  const rssSummary = getArticleSummary("cached-rss-item");
  const otherBody = getArticleBody(other.id);
  deleteLocalThread(thread.id);
  deleteLocalThread(text.id);
  for (const id of [thread.id, text.id]) {
    assert.equal(getThread(id), null);
    assert.equal(getArticleBody(id), null);
    assert.equal(getArticleSummary(id), null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM feed_items WHERE id = ?").get(id).n, 0);
    for (const table of ["thread_posts", "article_bodies", "thread_summaries", "thread_titles", "thread_generation_attempts"]) {
      assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE feed_item_id = ?`).get(id).n, 0);
    }
    assert.ok(!listThreads(localBoardId).items.some((item) => item.id === id));
    assert.ok(!listFavoriteThreads().some((item) => item.id === id));
  }
  assert.ok(getThread(other.id));
  assert.equal(getArticleBody(other.id), otherBody);
  assert.equal(getArticleBody("cached-rss-item"), rssBody);
  assert.equal(getArticleSummary("cached-rss-item"), rssSummary);
  assert.ok(listFeeds().some((feed) => feed.id === localBoardId));
});

test("自由スレ削除はRSSスレ・処理中スレ・存在しないスレを拒否してロックを解放する", async () => {
  const { deleteLocalThread } = await import("../dist/main/threads/deleteLocalThread.js");
  const { thread } = await createLocalThread(textRequest("削除ロック"));
  acquireThreadLock(thread.id);
  assert.throws(() => deleteLocalThread(thread.id), /現在処理中/);
  assert.ok(getThread(thread.id));
  releaseThreadLock(thread.id);
  assert.throws(() => deleteLocalThread("cached-rss-item"), /自由板でのみ/);
  assert.ok(getThread("cached-rss-item"));
  assert.ok(acquireThreadLock("cached-rss-item"));
  releaseThreadLock("cached-rss-item");
  assert.throws(() => deleteLocalThread("local:missing"), /見つかりません/);
  assert.ok(acquireThreadLock("local:missing"));
  releaseThreadLock("local:missing");
  deleteLocalThread(thread.id);
  assert.equal(getThread(thread.id), null);
  assert.ok(acquireThreadLock(thread.id));
  releaseThreadLock(thread.id);
});
