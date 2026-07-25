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
  saveArticleBody,
  saveRawVipTitleFallbacks,
  saveRssThreadSummaries
} = await import("../dist/main/db/repository.js");
const { startThreadResponseGeneration } = await import("../dist/main/threads/openThread.js");
const { buildVipThreadResponsePrompt } = await import("../dist/main/prompts/vipThreadResponsePrompt.js");
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

test("広告ブロック設定をSQLiteへ保存して再読込できる", () => {
  saveRendererUserSetting("articleBrowserBlockingEnabled", "false");
  assert.equal(getRendererUserSetting("articleBrowserBlockingEnabled"), "false");

  saveRendererUserSetting("articleBrowserBlockingEnabled", "true");
  assert.equal(getRendererUserSetting("articleBrowserBlockingEnabled"), "true");
});
