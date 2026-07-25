import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";

const testDirectory = mkdtempSync(path.join(tmpdir(), "viper-reader-failure-test-"));
process.env.VIPER_READER_DB_PATH = path.join(testDirectory, "test.db");
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

const { getDatabase } = await import("../dist/main/db/database.js");
const {
  generateJson,
  missingApiKeyMessage,
  parseJsonResponse,
  raceWithTimeout
} = await import("../dist/main/ai/genaiClient.js");
const { scrapeArticle } = await import("../dist/main/scraper/articleScraper.js");

const db = getDatabase();

after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

test("APIキー未設定時は外部呼び出しを行わずエラー結果を返す", async () => {
  const result = await generateJson({
    model: "test-model",
    purpose: "thread_response",
    contents: "test",
    parse: JSON.parse
  });

  assert.equal(result.value, null);
  assert.equal(result.responseText, "");
  assert.equal(result.errorMessage, missingApiKeyMessage);
});

test("Geminiの不正JSONは安全にnullへ変換する", () => {
  assert.equal(parseJsonResponse("これはJSONではない", JSON.parse), null);
  assert.equal(
    parseJsonResponse('```json\n{"ok":true}\n```', JSON.parse).ok,
    true
  );
  assert.equal(
    parseJsonResponse('{"ok":true}', () => {
      throw new Error("schema mismatch");
    }),
    null
  );
});

test("Gemini呼び出しが制限時間を超えたら用途付きのエラーにする", async () => {
  const neverCompletes = new Promise(() => undefined);

  await assert.rejects(
    raceWithTimeout(neverCompletes, 5, "thread_response"),
    /Gemini API 呼び出しがタイムアウトしました \(0.005秒\) \[thread_response\]/
  );
});

test("HTTP以外の記事URLは取得せずfetch_failedとして扱う", async () => {
  const result = await scrapeArticle("file:///etc/passwd");

  assert.equal(result.success, false);
  assert.equal(result.reason, "fetch_failed");
  assert.equal(result.contentText, "");
  assert.equal(result.contentSize, 0);
});
