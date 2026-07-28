import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const testDirectory = mkdtempSync(path.join(tmpdir(), "viper-reader-test-"));
process.env.VIPER_READER_DB_PATH = path.join(testDirectory, "test.db");
delete process.env.GEMINI_API_KEY;

const { getDatabase } = await import("../dist/main/db/database.js");
const {
  listUnconvertedFeedItems,
  getReadingQueueSummary,
  listGeneratedQueue,
  markThreadGenerationReviewed,
  setThreadGenerationState,
  upsertFeedItems,
  saveArticleBody,
  saveRawVipTitleFallbacks,
  saveRssThreadSummaries
} = await import("../dist/main/db/repository.js");
const { startThreadResponseGeneration } = await import("../dist/main/threads/openThread.js");
const { buildVipThreadResponsePrompt } = await import("../dist/main/prompts/vipThreadResponsePrompt.js");
const { buildVipTitlePromptHash } = await import("../dist/main/prompts/vipTitlePrompt.js");
const { runFeedRefreshSingleFlight } = await import("../dist/main/rss/feedRefreshSingleFlight.js");
const {
  getRendererUserSetting,
  saveRendererUserSetting
} = await import("../dist/main/settings/settingsService.js");

const db = getDatabase();
const now = "2026-07-25T00:00:00.000Z";
const titleModel = "test-title-model";
const responseModel = "test-response-model";

after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

function insertFeed(id) {
  db.prepare(`
    INSERT INTO feed_sources (id, title, url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, `Feed ${id}`, `https://example.com/${id}.xml`, now, now);
}

function insertItem({ id, feedId, readAt = null }) {
  db.prepare(`
    INSERT INTO feed_items
      (id, feed_id, guid, title, url, published_at, raw_summary, read_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    feedId,
    id,
    `Title ${id}`,
    `https://example.com/articles/${id}`,
    now,
    `Summary ${id}`,
    readAt,
    now,
    now
  );
}

test("スレタイ自動変換は未読かつ未変換の記事だけを対象にする", () => {
  insertFeed("selection");
  insertItem({ id: "unread", feedId: "selection" });
  insertItem({ id: "read", feedId: "selection", readAt: now });
  insertItem({ id: "converted", feedId: "selection" });
  db.prepare(`
    INSERT INTO vip_titles (id, feed_item_id, model, prompt_hash, title, generated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("vip:converted", "converted", titleModel, "test-prompt", "変換済み", now);

  const items = listUnconvertedFeedItems("selection", titleModel, "test-prompt");

  assert.deepEqual(items.map((item) => item.id), ["unread"]);
});

test("スレタイ生成モードごとに異なるプロンプトハッシュを使う", () => {
  assert.notEqual(
    buildVipTitlePromptHash(false),
    buildVipTitlePromptHash(true)
  );
});

test("同じフィードの並行更新は一つの処理を共有する", async () => {
  let invocationCount = 0;
  let finishRefresh;
  const task = () => {
    invocationCount += 1;
    return new Promise((resolve) => {
      finishRefresh = resolve;
    });
  };

  const first = runFeedRefreshSingleFlight("single-flight", task);
  const second = runFeedRefreshSingleFlight("single-flight", task);
  assert.equal(invocationCount, 1);

  finishRefresh("done");
  assert.deepEqual(await Promise.all([first, second]), ["done", "done"]);

  const third = runFeedRefreshSingleFlight("single-flight", async () => {
    invocationCount += 1;
    return "next";
  });
  assert.equal(await third, "next");
  assert.equal(invocationCount, 2);
});

test("生成完了した記事は確認するまで生成済みキューに残る", () => {
  insertFeed("queue");
  insertItem({ id: "queued-item", feedId: "queue", readAt: now });

  setThreadGenerationState("queued-item", "queued");
  assert.equal(getReadingQueueSummary().queuedCount, 1);

  setThreadGenerationState("queued-item", "generating");
  assert.equal(getReadingQueueSummary().generatingCount, 1);

  setThreadGenerationState("queued-item", "completed");
  assert.equal(getReadingQueueSummary().completedCount, 1);
  assert.deepEqual(listGeneratedQueue().items.map((item) => item.id), ["queued-item"]);

  markThreadGenerationReviewed("queued-item");
  assert.equal(getReadingQueueSummary().completedCount, 0);
  assert.equal(getReadingQueueSummary().reviewedCount, 1);
  assert.deepEqual(listGeneratedQueue().items, []);
  assert.deepEqual(listGeneratedQueue(0, 100, true).items.map((item) => item.id), ["queued-item"]);
});

test("本文キャッシュがあれば再取得せず、実際の生成工程だけを通知する", async () => {
  insertFeed("progress");
  insertItem({ id: "cached", feedId: "progress" });
  const initialItem = {
    id: "cached",
    title: "Title cached",
    url: "https://example.com/articles/cached",
    publishedAt: now,
    rawSummary: "Summary cached"
  };
  saveRawVipTitleFallbacks([initialItem], titleModel);
  saveRssThreadSummaries([initialItem], responseModel);
  saveArticleBody("cached", initialItem.url, "キャッシュ済みの技術記事本文");

  const progress = [];
  const completion = await new Promise((resolve) => {
    startThreadResponseGeneration(
      "cached",
      false,
      resolve,
      (event) => progress.push(event.stage)
    );
  });

  assert.equal(completion, "skipped");
  assert.deepEqual(progress, [
    "checking-cache",
    "preparing-context",
    "generating-posts"
  ]);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM article_fetch_logs WHERE feed_item_id = ?")
      .get("cached").count,
    0
  );
});

test("RSSの記事内容が訂正されたら派生キャッシュを失効する", () => {
  insertFeed("corrected");
  insertItem({ id: "corrected-item", feedId: "corrected" });
  const originalItem = {
    id: "corrected-item",
    title: "Title corrected-item",
    url: "https://example.com/articles/corrected-item",
    publishedAt: now,
    rawSummary: "Summary corrected-item"
  };
  saveRawVipTitleFallbacks([originalItem], titleModel);
  saveRssThreadSummaries([originalItem], responseModel);
  saveArticleBody(originalItem.id, originalItem.url, "元の記事本文");

  const result = upsertFeedItems("corrected", [{
    ...originalItem,
    feedId: "corrected",
    guid: originalItem.id,
    title: "訂正後のタイトル",
    url: "https://example.com/articles/corrected-item-v2",
    rawSummary: "訂正後の概要"
  }]);

  assert.equal(result.updatedCount, 1);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM vip_titles WHERE feed_item_id = ?")
      .get(originalItem.id).count,
    0
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM thread_summaries WHERE feed_item_id = ?")
      .get(originalItem.id).count,
    0
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM article_bodies WHERE feed_item_id = ?")
      .get(originalItem.id).count,
    0
  );
});

test("本文取得失敗時のプロンプトは推測による補完を禁止する", () => {
  const prompt = buildVipThreadResponsePrompt({
    vipTitle: "テストスレ",
    originalTitle: "テスト記事",
    url: "https://example.com/article",
    rssBody: "RSSの概要",
    scrapedBody: null,
    publishedAt: now,
    residentPrompt: null
  });

  assert.match(prompt, /本文の内容を想像で捏造して解説することは絶対に避けてください/);
  assert.match(prompt, /「取得に失敗した」という事実のみを扱ってください/);
  assert.doesNotMatch(prompt, /RSSの概要/);
});

test("本文取得成功時のプロンプトは不要な不明点の付記を避ける", () => {
  const prompt = buildVipThreadResponsePrompt({
    vipTitle: "テストスレ",
    originalTitle: "テスト記事",
    url: "https://example.com/article",
    rssBody: "RSSの概要",
    scrapedBody: "取得できた記事本文",
    publishedAt: now,
    residentPrompt: null
  });

  assert.match(prompt, /記事にない詳細へわざわざ言及したり/);
  assert.match(prompt, /「まだ分からない」と定型的に付け足したりしない/);
  assert.match(prompt, /記事の結論や読者の判断を左右する場合に限り/);
});

test("記事のプロンプトは主題と無関係な分野の語彙や視点を禁止する", () => {
  const prompt = buildVipThreadResponsePrompt({
    vipTitle: "商店街の夏祭り開催決定ｗｗｗ",
    originalTitle: "商店街で夏祭りを開催",
    url: "https://example.com/festival",
    rssBody: "",
    scrapedBody: "商店街は8月に夏祭りを開催すると発表した。",
    publishedAt: "2026-07-27",
    residentPrompt: null
  });

  assert.match(prompt, /記事の分野に詳しく/);
  assert.match(prompt, /元記事と無関係な分野の用語、比喩、専門家視点/);
  assert.doesNotMatch(prompt, /エンジニアにとっての実用上の影響/);
});

test("広告ブロック設定をSQLiteへ保存して再読込できる", () => {
  saveRendererUserSetting("articleBrowserBlockingEnabled", "false");
  assert.equal(getRendererUserSetting("articleBrowserBlockingEnabled"), "false");

  saveRendererUserSetting("articleBrowserBlockingEnabled", "true");
  assert.equal(getRendererUserSetting("articleBrowserBlockingEnabled"), "true");
});

test("ペインとカラムのレイアウト設定を保存できる", () => {
  saveRendererUserSetting("feedPaneWidth", "420");
  saveRendererUserSetting("feedTreeHeight", "280");
  saveRendererUserSetting("threadColumnWidthsV3", "[38,500,170,300,54,126,260]");

  assert.equal(getRendererUserSetting("feedPaneWidth"), "420");
  assert.equal(getRendererUserSetting("feedTreeHeight"), "280");
  assert.equal(
    getRendererUserSetting("threadColumnWidthsV3"),
    "[38,500,170,300,54,126,260]"
  );
});
