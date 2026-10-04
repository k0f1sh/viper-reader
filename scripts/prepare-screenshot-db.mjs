import crypto from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import Parser from "rss-parser";

const [databasePath, fixtureOrigin, settingsDatabasePath] = process.argv.slice(2);
if (!databasePath || !fixtureOrigin || !settingsDatabasePath) {
  throw new Error("Usage: node scripts/prepare-screenshot-db.mjs DB_PATH FIXTURE_ORIGIN SETTINGS_DB_PATH");
}
if (existsSync(databasePath)) rmSync(databasePath);
process.argv.push(`--db-path=${databasePath}`);

const { getDatabase } = await import("../dist/main/db/database.js");
const { addFeedSource } = await import("../dist/main/db/feedRepository.js");
const {
  listFeedItemsForInitialCaches,
  recordTitleGenerationAttempts,
  saveArticleBody,
  saveRawThreadTitleFallbacks,
  saveRssThreadSummaries,
  saveThreadTitles,
  setThreadFavorite,
  setThreadRead,
  upsertFeedItems
} = await import("../dist/main/db/repository.js");
const { transformTitlesToBoardStyle } = await import("../dist/main/ai/titleTransformer.js");
const { buildThreadTitlePromptHash } = await import("../dist/main/prompts/threadTitlePrompt.js");
const { getActiveModel, getTitleGenerationModel } = await import("../dist/main/settings/settingsService.js");
const { startThreadResponseGeneration } = await import("../dist/main/threads/openThread.js");

const db = getDatabase();
copyScreenshotSettings(db, settingsDatabasePath);
const parser = new Parser();
const feedDefinitions = [
  ["AI・開発", "ai-dev"],
  ["Webフロントエンド", "web-ui"],
  ["Linux・OSS", "linux-oss"]
];
const allItemIds = [];

for (const [feedTitle, slug] of feedDefinitions) {
  const feedUrl = `${fixtureOrigin}/feeds/${slug}.xml`;
  const feed = addFeedSource(feedTitle, feedUrl, false);
  const response = await fetch(feedUrl);
  if (!response.ok) throw new Error(`Fixture RSS request failed: ${response.status}`);
  const parsed = await parser.parseString(await response.text());
  const items = parsed.items.map((item) => {
    const guid = item.guid ?? item.link;
    const id = `${feed.id}:${crypto.createHash("sha1").update(`${feed.id}:${guid}`).digest("hex").slice(0, 16)}`;
    return {
      id,
      feedId: feed.id,
      guid,
      title: item.title,
      url: item.link,
      publishedAt: new Date(item.pubDate).toISOString(),
      rawSummary: item.contentSnippet ?? item.content ?? null
    };
  });
  upsertFeedItems(feed.id, items);
  const cacheItems = listFeedItemsForInitialCaches(feed.id);
  saveRawThreadTitleFallbacks(cacheItems, getTitleGenerationModel());
  saveRssThreadSummaries(cacheItems, getActiveModel());
  for (const item of items) {
    saveArticleBody(item.id, item.url, `${item.rawSummary}\n\nこの記事はViperReaderのスクリーンショット用に作成した架空の技術記事です。実装方法、性能測定、導入時の注意点を順に解説します。`);
  }
  const transformed = await transformTitlesToBoardStyle(feed.id, feed.title, items, false);
  const promptHash = buildThreadTitlePromptHash(false);
  saveThreadTitles(transformed.titles, getTitleGenerationModel(), promptHash);
  recordTitleGenerationAttempts(transformed.outcomes, getTitleGenerationModel(), promptHash);
  allItemIds.push(...items.map((item) => item.id));
}

await generateThread(allItemIds[0]);
for (const id of allItemIds.slice(1, 5)) setThreadRead(id, true);
for (const id of [allItemIds[0], allItemIds[5], allItemIds[10]]) setThreadFavorite(id, true);

db.prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)")
  .run("threadListHeight", "32", new Date().toISOString());
db.prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)")
  .run("threadColumnWidthsV3", JSON.stringify([44, 480, 130, 220, 54, 126, 180]), new Date().toISOString());
db.close();
process.stdout.write(`${databasePath}\n`);

function copyScreenshotSettings(targetDb, sourcePath) {
  const sourceDb = new DatabaseSync(sourcePath, { readOnly: true });
  const keys = ["geminiApiKey", "titleModel", "replyModel"];
  const read = sourceDb.prepare("SELECT key, value, updated_at FROM user_settings WHERE key = ?");
  const write = targetDb.prepare("INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)");
  for (const key of keys) {
    const row = read.get(key);
    if (row) write.run(row.key, row.value, row.updated_at);
  }
  sourceDb.close();
}

function generateThread(threadId) {
  return new Promise((resolve, reject) => {
    startThreadResponseGeneration(threadId, false, (status) => {
      if (status === "done") resolve();
      else reject(new Error(`Thread generation finished with status: ${status}`));
    });
  });
}
