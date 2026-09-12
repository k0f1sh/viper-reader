import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { promises as dns } from "node:dns";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const directory = mkdtempSync(path.join(tmpdir(), "viper-tags-"));
process.env.VIPER_READER_DB_PATH = path.join(directory, "test.db");
process.env.GEMINI_API_KEY = "test-key";
delete process.env.GOOGLE_API_KEY;
const { normalizeArticleTags, parseArticleTags, formatArticleTags, hasAiArticleTag } = await import("../dist/shared/articleTags.js");
const { validateConvertedTitles, transformTitlesToBoardStyle } = await import("../dist/main/ai/titleTransformer.js");
const { buildThreadTitlePrompt, buildThreadTitlePromptHash, buildLegacyThreadTitlePromptHash } = await import("../dist/main/prompts/threadTitlePrompt.js");
const { getDatabase } = await import("../dist/main/db/database.js");
const { upsertFeedItems, saveThreadTitles, listUnconvertedFeedItems, recordTitleGenerationAttempts } = await import("../dist/main/db/feedItemRepository.js");
const { getThread, listThreads, listFavoriteThreads, listGeneratedQueue } = await import("../dist/main/db/threadRepository.js");
const { getTitleGenerationModel } = await import("../dist/main/settings/settingsService.js");
const { regenerateThreadTitle } = await import("../dist/main/threads/regenerateThreadTitle.js");
const { refreshFeed } = await import("../dist/main/rss/refreshFeed.js");
const db = getDatabase();
const model = getTitleGenerationModel();
const now = "2026-09-13T00:00:00.000Z";
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

function fixture(id, useSummary = false) {
  db.prepare("INSERT INTO feed_sources (id, title, url, generate_title_from_summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, id, `https://example.com/${id}.xml`, Number(useSummary), now, now);
  const item = { id, feedId: id, guid: id, title: "ChatGPTでSQLを改善した", url: `https://example.com/${id}`, publishedAt: now, rawSummary: "概要" };
  upsertFeedItems(id, [item]);
  return item;
}

function legacyTitle(item, useSummary = false, titleModel = model) {
  db.prepare("INSERT INTO thread_titles (id, feed_item_id, model, prompt_hash, title, generated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(`legacy:${item.id}:${useSummary}:${titleModel}`, item.id, titleModel, buildLegacyThreadTitlePromptHash(useSummary), "以前のスレタイ", now);
}

function geminiResponse(value) {
  return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }] });
}

test("AI・LLMの表記と重複を統一し、上限でも両方を保持する", () => {
  assert.deepEqual(normalizeArticleTags([" 人工知能 ", "ai", "大規模言語モデル", "LLMs", "ChatGPT", " SQL ", "sql"]), ["AI", "LLM", "ChatGPT", "SQL"]);
  assert.deepEqual(normalizeArticleTags(["Rust", "rust", "", "  "]), ["Rust"]);
  assert.deepEqual(normalizeArticleTags(["A", "B", "C", "D", "E", "large language model"]), ["AI", "LLM", "A", "B", "C"]);
  assert.deepEqual(normalizeArticleTags(["画像生成", "Artificial Intelligence"]), ["AI", "画像生成"]);
  for (const invalid of [null, undefined, "AI", {}, ["AI", 1]]) assert.equal(normalizeArticleTags(invalid), null);
  assert.equal(parseArticleTags("broken"), null);
  assert.equal(parseArticleTags(null), null);
  assert.deepEqual(parseArticleTags("[]"), []);
  assert.equal(formatArticleTags(null), "未生成");
  assert.equal(formatArticleTags([]), "なし");
  assert.equal(formatArticleTags(["AI", "LLM"]), "AI / LLM");
  assert.equal(hasAiArticleTag(["AI"]), true);
  assert.equal(hasAiArticleTag(["LLM"]), true);
  assert.equal(hasAiArticleTag(["OpenAI", "機械学習"]), false);
  assert.equal(hasAiArticleTag([]), false);
  assert.equal(hasAiArticleTag(null), false);
});

test("タグ欠落・不正値・未知IDを記事単位で拒否し、後続の正常記事を保存できる", () => {
  const sources = ["ai", "rust", "unknown", "bad", "missing"].map((id) => ({ id }));
  assert.deepEqual(validateConvertedTitles([
    null, 42, {},
    { feedItemId: "ai", threadTitle: " SQL改善ｷﾀｺﾚ ", tags: ["LLM", "ChatGPT", "SQL"] },
    { feedItemId: "ai", threadTitle: "重複", tags: [] },
    { feedItemId: "bad", threadTitle: "不正", tags: "AI" },
    { feedItemId: "missing", threadTitle: "欠落" },
    { feedItemId: "outside", threadTitle: "余分", tags: [] },
    { feedItemId: "rust", threadTitle: "所有権", tags: ["Rust"] },
    { feedItemId: "unknown", threadTitle: "今日考えたこと", tags: [] }
  ], sources), [
    { feedItemId: "ai", title: "SQL改善ｷﾀｺﾚ", tags: ["AI", "LLM", "ChatGPT", "SQL"] },
    { feedItemId: "rust", title: "所有権", tags: ["Rust"] },
    { feedItemId: "unknown", title: "今日考えたこと", tags: [] }
  ]);
});

test("概要モードでもタグは元タイトル限定で、旧ハッシュと区別する", () => {
  for (const useSummary of [false, true]) {
    const prompt = buildThreadTitlePrompt("AIニュース", [{ id: "a", title: "Rustの所有権", url: "https://example.com/ai", publishedAt: now, rawSummary: "ChatGPTを利用した" }], useSummary);
    assert.match(prompt, /tagsは元タイトル（title）だけ/);
    assert.match(prompt, /AIを道具として利用した記事にも「AI」/);
    assert.match(prompt, /概要だけにAIの記述があっても/);
    assert.equal(prompt.includes('"rssSummary":"ChatGPTを利用した"'), useSummary);
    assert.notEqual(buildThreadTitlePromptHash(useSummary), buildLegacyThreadTitlePromptHash(useSummary));
  }
});

test("旧スレタイを全一覧・詳細で保持し、未読だけを再生成対象にする", () => {
  for (const useSummary of [false, true]) {
    const item = fixture(`legacy-${useSummary}`, useSummary);
    legacyTitle(item, useSummary);
    db.prepare("UPDATE feed_items SET is_favorite = 1, generation_status = 'completed' WHERE id = ?").run(item.id);
    const readViews = () => [getThread(item.id), listThreads(item.feedId).items[0], listThreads(null).items.find((row) => row.id === item.id), listFavoriteThreads().find((row) => row.id === item.id), listGeneratedQueue().items.find((row) => row.id === item.id)];
    for (const row of readViews()) {
      assert.equal(row.threadTitle, "以前のスレタイ");
      assert.equal(row.tags, null);
    }
    const hash = buildThreadTitlePromptHash(useSummary);
    assert.deepEqual(listUnconvertedFeedItems(item.feedId, model, hash).map((row) => row.id), [item.id]);
    recordTitleGenerationAttempts([{ feedItemId: item.id, status: "failed", errorMessage: "タグ欠落" }], model, hash);
    assert.equal(getThread(item.id).threadTitle, "以前のスレタイ");
    assert.equal(getThread(item.id).titleGenerationStatus, "failed");
    db.prepare("UPDATE feed_items SET read_at = ? WHERE id = ?").run(now, item.id);
    assert.deepEqual(listUnconvertedFeedItems(item.feedId, model, hash), []);
    assert.equal(getThread(item.id).threadTitle, "以前のスレタイ");
    saveThreadTitles([{ feedItemId: item.id, title: "新スレタイ", tags: ["AI", "LLM"] }], model, hash);
    for (const row of readViews()) {
      assert.equal(row.threadTitle, "新スレタイ");
      assert.deepEqual(row.tags, ["AI", "LLM"]);
    }
    db.prepare("UPDATE feed_items SET generation_reviewed_at = ? WHERE id = ?").run(now, item.id);
    assert.deepEqual(listGeneratedQueue(0, 100, true).items.find((row) => row.id === item.id).tags, ["AI", "LLM"]);
  }
});

test("旧スレタイのモデル・生成設定が違う場合は混用しない", () => {
  const item = fixture("legacy-mismatch");
  legacyTitle(item, true);
  legacyTitle(item, false, "different-model");
  assert.equal(getThread(item.id).threadTitle, item.title);
  assert.equal(getThread(item.id).tags, null);
});

test("RSS更新はタイトルとタグを1回で生成し、キャッシュ済みならAPIを呼ばない", async (t) => {
  const item = fixture("refresh-tags");
  const calls = [];
  let resultTags = ["LLM", "ChatGPT", "SQL"];
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = String(input);
    calls.push(url);
    if (url === `https://example.com/${item.id}.xml`) return new Response(`<rss version="2.0"><channel><title>Feed</title><item><guid>${item.guid}</guid><title>${item.title}</title><link>${item.url}</link><pubDate>Sun, 13 Sep 2026 00:00:00 GMT</pubDate><description>概要</description></item></channel></rss>`);
    assert.match(url, /^https:\/\/generativelanguage.googleapis.com\//);
    const request = JSON.parse(options.body);
    assert.ok(request.generationConfig.responseSchema.items.required.includes("tags"));
    return geminiResponse([{ feedItemId: item.id, threadTitle: "SQL改善ｷﾀｺﾚ", tags: resultTags }]);
  });
  const result = await refreshFeed(item.feedId);
  assert.equal(result.convertedCount, 1);
  assert.equal(calls.length, 2);
  assert.deepEqual(getThread(item.id).tags, ["AI", "LLM", "ChatGPT", "SQL"]);
  await refreshFeed(item.feedId);
  assert.equal(calls.length, 3); // RSS only
  db.prepare("UPDATE feed_items SET read_at = ? WHERE id = ?").run(now, item.id);
  resultTags = [];
  const regenerated = await regenerateThreadTitle(item.id);
  assert.deepEqual(regenerated.tags, []);
  assert.equal(calls.length, 4);
  // Failed manual regeneration must leave the previous result intact.
  resultTags = "invalid";
  await assert.rejects(regenerateThreadTitle(item.id), /再生成に失敗/);
  assert.deepEqual(getThread(item.id).tags, []);
  db.prepare("UPDATE feed_sources SET skip_title_conversion = 1 WHERE id = ?").run(item.feedId);
  await refreshFeed(item.feedId);
  assert.equal(calls.length, 6); // failed generation + RSS only
  assert.equal(getThread(item.id).threadTitle, item.title);
  assert.equal(getThread(item.id).tags, null);
  await assert.rejects(regenerateThreadTitle(item.id), /スレタイ変換しない/);
  assert.equal(calls.length, 6);
});

test("不正タグを含むバッチでも正常記事の生成結果と失敗件数を返す", async (t) => {
  const item = fixture("partial-batch");
  t.mock.method(globalThis, "fetch", async () => geminiResponse([
    { feedItemId: "good", threadTitle: "成功", tags: ["Rust"] },
    { feedItemId: "bad", threadTitle: "失敗" }
  ]));
  const result = await transformTitlesToBoardStyle(item.feedId, "Feed", [{ ...item, id: "good" }, { ...item, id: "bad" }]);
  assert.equal(result.failedCount, 1);
  assert.deepEqual(result.titles, [{ feedItemId: "good", title: "成功", tags: ["Rust"] }]);
  assert.deepEqual(result.outcomes.map((row) => row.status), ["completed", "failed"]);
});

test("記事タイトルの更新で古いタグと旧スレタイをともに無効化する", () => {
  const item = fixture("invalidate-tags");
  legacyTitle(item);
  saveThreadTitles([{ feedItemId: item.id, title: "AI記事", tags: ["AI", "LLM"] }], model, buildThreadTitlePromptHash(false));
  upsertFeedItems(item.feedId, [{ ...item, title: "Rustの所有権" }]);
  assert.equal(getThread(item.id).tags, null);
  assert.equal(getThread(item.id).threadTitle, "Rustの所有権");
  assert.equal(listUnconvertedFeedItems(item.feedId, model, buildThreadTitlePromptHash(false)).length, 1);
});
