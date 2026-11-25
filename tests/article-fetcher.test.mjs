import assert from "node:assert/strict";
import test from "node:test";
import { ArticlePage, EmptyArticleError, runArticleFetcher } from "../dist/main/scraper/articleFetcher.js";

const url = "https://example.org/start";
const finalUrl = "https://example.org/articles/one";
const html = "<html><body><article><p>記事本文です。</p></article></body></html>";

test("標準スクリプトはHTMLを一度取得して本文を返す", async () => {
  const requests = [];
  const result = await runArticleFetcher(url, async target => {
    requests.push(target);
    return new ArticlePage(html, finalUrl);
  });
  assert.deepEqual(requests, [url]);
  assert.equal(result.bodyText, "記事本文です。");
  assert.equal(result.customData, undefined);
});

test("同じ応答のHTMLと最終URLを使い、JSONの型を保つ", async () => {
  const result = await runArticleFetcher(url, async () => new ArticlePage(html, finalUrl), `
    (define-article-fetcher (item)
      (let* ((page (http-get (item-url item)))
             (body (extract-article-text (response-text page) (response-url page))))
        (article-result body (js-obj "html" (response-text page) "url" (response-url page)
                                     "comments" (vector) "flag" #f))))`);
  assert.deepEqual(result.customData, { html, url: finalUrl, comments: [], flag: false });
});

test("並行する評価が個別の関数定義とHTTP応答を保持する", async () => {
  let resume;
  const pending = new Promise(resolve => { resume = resolve; });
  const first = runArticleFetcher(url, () => pending, `
    (define (label) "first")
    (define-article-fetcher (item) (http-get (item-url item)) (article-result (label)))`);
  const second = await runArticleFetcher(url, async () => new ArticlePage("", url), `
    (define (label) "second")
    (define-article-fetcher (item) (article-result (label)))`);
  resume(new ArticlePage("", url));
  assert.equal(second.bodyText, "second");
  assert.equal((await first).bodyText, "first");
});

test("非同期取得と再開後の本文抽出の失敗を呼び出し元に返す", async () => {
  await assert.rejects(runArticleFetcher(url, async () => { throw Error("offline"); }), /offline/);
  await assert.rejects(runArticleFetcher(url, async () => new ArticlePage("", url)), EmptyArticleError);
});
