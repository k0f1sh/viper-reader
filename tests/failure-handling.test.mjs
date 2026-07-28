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
  missingApiKeyMessage
} = await import("../dist/main/ai/genaiClient.js");
const { scrapeArticle } = await import("../dist/main/scraper/articleScraper.js");
const { assertSafeNetworkUrl, createPinnedLookup } = await import("../dist/main/network/safeFetch.js");
const { findUngroundedNumericClaims } = await import("../dist/main/ai/factualGrounding.js");
const { sendIfAvailable } = await import("../dist/main/ipc/safeSender.js");
const { normalizePostBody } = await import("../dist/shared/postBody.js");

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

const fakeTransport = (generateContent) => ({
  apiKey: "test-api-key",
  generateContent
});

test("Geminiの不正JSONはgenerateJson全体で安全にエラー結果へ変換する", async () => {
  const invalid = await generateJson(
    {
      model: "test-model",
      purpose: "thread_response",
      contents: "test",
      parse: JSON.parse
    },
    fakeTransport(async () => ({ text: "これはJSONではない" }))
  );
  assert.equal(invalid.value, null);
  assert.equal(invalid.errorMessage, "JSON パースに失敗しました");

  const fenced = await generateJson(
    {
      model: "test-model",
      purpose: "thread_response",
      contents: "test",
      parse: JSON.parse
    },
    fakeTransport(async () => ({ text: '```json\n{"ok":true}\n```' }))
  );
  assert.equal(fenced.value.ok, true);
  assert.equal(fenced.errorMessage, null);
});

test("JSON構文エラーと保存前の追加検証エラーを区別する", async () => {
  const result = await generateJson(
    {
      model: "test-model",
      purpose: "thread_response",
      contents: "test",
      parse: () => {
        throw new Error("記事に根拠のない数値表現があります: 50%");
      }
    },
    fakeTransport(async () => ({ text: '{"body":"50%高速化"}' }))
  );

  assert.equal(result.value, null);
  assert.equal(result.errorMessage, "記事に根拠のない数値表現があります: 50%");
});

test("Gemini呼び出し全体が制限時間を超えたら用途付きのエラー結果を返す", async () => {
  const result = await generateJson(
    {
      model: "test-model",
      purpose: "thread_response",
      contents: "test",
      timeoutMs: 5,
      parse: JSON.parse
    },
    fakeTransport(() => new Promise(() => undefined))
  );

  assert.equal(result.value, null);
  assert.match(
    result.errorMessage,
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

test("localhostとループバックアドレスへの取得を拒否する", async () => {
  await assert.rejects(
    assertSafeNetworkUrl(new URL("http://localhost:3000/feed")),
    /ローカルホストへのアクセスを拒否/
  );
  await assert.rejects(
    assertSafeNetworkUrl(new URL("http://127.0.0.1:3000/feed")),
    /ローカルネットワークまたは予約済みアドレスへのアクセスを拒否/
  );
  await assert.rejects(
    assertSafeNetworkUrl(new URL("http://[::1]:3000/feed")),
    /ローカルネットワークまたは予約済みアドレスへのアクセスを拒否/
  );
});

test("生成文中の根拠がない数値・バージョンを検出する", () => {
  assert.deepEqual(
    findUngroundedNumericClaims(
      "v2.1では処理が50%高速化し、3件の問題を修正した",
      ["v2.1では3件の問題を修正した"]
    ),
    ["50%"]
  );
  assert.deepEqual(
    findUngroundedNumericClaims(
      ">>2 の通り、v2.1で3件修正",
      ["v2.1で3件修正"]
    ),
    []
  );
  assert.deepEqual(
    findUngroundedNumericClaims(
      "重要な点は3つある",
      ["重要な点を説明する"]
    ),
    []
  );
});

test("破棄済みまたは送信失敗したIPC senderを安全に無視する", () => {
  let sendCount = 0;
  assert.equal(sendIfAvailable({
    isDestroyed: () => true,
    send: () => {
      sendCount += 1;
    }
  }, "test"), false);
  assert.equal(sendCount, 0);

  assert.equal(sendIfAvailable({
    isDestroyed: () => false,
    send: () => {
      throw new Error("sender was destroyed");
    }
  }, "test"), false);
});

test("検査済みIPをDNS再解決せず接続先へ固定する", async () => {
  const lookup = createPinnedLookup({ address: "203.0.113.10", family: 4 });
  const resolved = await new Promise((resolve, reject) => {
    lookup("attacker.example", { all: false }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });

  assert.deepEqual(resolved, { address: "203.0.113.10", family: 4 });
});

test("生成レスのbrタグを改行へ正規化する", () => {
  assert.equal(
    normalizePostBody("1行目<br>2行目<BR />3行目<br/>4行目\r\n5行目"),
    "1行目\n2行目\n3行目\n4行目\n5行目"
  );
});
