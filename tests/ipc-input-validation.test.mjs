import assert from "node:assert/strict";
import test from "node:test";

const {
  assertArticleBrowserBounds,
  assertBoolean,
  assertHttpUrl,
  assertIdentifier,
  assertPage,
  assertPromptDecision,
  assertReplyRating,
  assertShowArticleBrowserRequest,
  assertString,
  assertStringArray
} = await import("../dist/main/ipc/inputValidation.js");

test("IPCの識別子と文字列に型・空文字・長さ制限を適用する", () => {
  assert.doesNotThrow(() => assertIdentifier("thread:123", "thread ID"));
  assert.throws(() => assertIdentifier("", "thread ID"), /Invalid thread ID/);
  assert.throws(() => assertIdentifier(123, "thread ID"), /Invalid thread ID/);
  assert.throws(
    () => assertString("too long", "short value", { maxLength: 3 }),
    /Invalid short value/
  );
});

test("IPCのページ番号と真偽値を厳密に検証する", () => {
  assert.doesNotThrow(() => assertPage(0));
  assert.doesNotThrow(() => assertBoolean(false, "flag"));
  for (const invalidPage of [-1, 1.5, Number.NaN, "0", 1_000_001]) {
    assert.throws(() => assertPage(invalidPage), /Invalid page/);
  }
  assert.throws(() => assertBoolean(0, "flag"), /Invalid flag/);
});

test("外部URLは認証情報のないHTTPまたはHTTPSだけを許可する", () => {
  assert.doesNotThrow(() => assertHttpUrl("https://example.com/feed.xml", "feed URL"));
  for (const invalidUrl of [
    "not a url",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:password@example.com/"
  ]) {
    assert.throws(() => assertHttpUrl(invalidUrl, "feed URL"), /Invalid feed URL/);
  }
});

test("IPCの配列と列挙値に件数・長さ・候補制限を適用する", () => {
  assert.doesNotThrow(() =>
    assertStringArray(["a", "b"], "tags", { maxItems: 2, maxItemLength: 1 })
  );
  assert.throws(
    () => assertStringArray(["a", "b", "c"], "tags", { maxItems: 2, maxItemLength: 1 }),
    /Invalid tags/
  );
  assert.throws(
    () => assertStringArray(["ab"], "tags", { maxItems: 2, maxItemLength: 1 }),
    /Invalid tags/
  );
  assert.doesNotThrow(() => assertReplyRating("good"));
  assert.throws(() => assertReplyRating("average"), /Invalid reply rating/);
  assert.doesNotThrow(() => assertPromptDecision("active"));
  assert.throws(() => assertPromptDecision("pending"), /Invalid prompt decision/);
});

test("記事ブラウザ要求はURL・ID・矩形・フラグをまとめて検証する", () => {
  const validRequest = {
    threadId: "thread:123",
    url: "https://example.com/article",
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    allowUnprotected: false
  };
  assert.doesNotThrow(() => assertShowArticleBrowserRequest(validRequest));
  assert.doesNotThrow(() => assertArticleBrowserBounds(validRequest.bounds));
  assert.throws(
    () => assertShowArticleBrowserRequest({ ...validRequest, url: "file:///etc/passwd" }),
    /Invalid article URL/
  );
  assert.throws(
    () => assertShowArticleBrowserRequest({
      ...validRequest,
      bounds: { x: 0, y: 0, width: 0, height: 600 }
    }),
    /Invalid article browser bounds/
  );
});
