import assert from "node:assert/strict";
import test from "node:test";

const { ARTICLE_BROWSER_USER_AGENT, ARTICLE_FETCH_USER_AGENT } = await import(
  "../dist/main/network/httpIdentity.js"
);

test("記事HTTP取得とアプリ内ブラウザで用途別のUAを使う", () => {
  assert.match(ARTICLE_FETCH_USER_AGENT, /Chrome\/150\.0\.0\.0/);
  assert.match(ARTICLE_BROWSER_USER_AGENT, /Chrome\/122\.0\.0\.0/);
  assert.notEqual(ARTICLE_FETCH_USER_AGENT, ARTICLE_BROWSER_USER_AGENT);
});
