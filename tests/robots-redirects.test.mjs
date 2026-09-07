import assert from "node:assert/strict";
import { promises as dns } from "node:dns";
import test from "node:test";

const { scrapeArticle } = await import("../dist/main/scraper/articleScraper.js");

const articleHtml = `<!doctype html>
<html><head><title>Test article</title></head>
<body><article><h1>Test article</h1><p>リダイレクト先から取得した記事本文です。</p></article></body></html>`;

function installNetworkMock(t, routes) {
  const calls = [];
  t.mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = String(input);
    calls.push({ url, options });
    const route = routes.get(url);
    if (!route) {
      throw new Error(`Unexpected request: ${url}`);
    }
    return route();
  });
  return calls;
}

function robotsResponse(contents) {
  return new Response(contents, {
    status: 200,
    headers: { "content-type": "text/plain" }
  });
}

function articleResponse() {
  return new Response(articleHtml, {
    status: 200,
    headers: { "content-type": "text/html" }
  });
}

test("同一オリジンのリダイレクト先パスがrobots.txtで禁止されていれば取得しない", async (t) => {
  const routes = new Map([
    ["https://same-origin.example/robots.txt", () => robotsResponse("User-agent: *\nDisallow: /blocked")],
    ["https://same-origin.example/start", () => new Response(null, {
      status: 302,
      headers: { location: "/blocked" }
    })],
    ["https://same-origin.example/blocked", articleResponse]
  ]);
  const calls = installNetworkMock(t, routes);

  const result = await scrapeArticle("https://same-origin.example/start");

  assert.equal(result.success, false);
  assert.equal(result.reason, "robots_disallowed");
  assert.equal(result.robotsResult, "disallowed");
  assert.deepEqual(calls.map((call) => call.url), [
    "https://same-origin.example/robots.txt",
    "https://same-origin.example/start"
  ]);
});

test("別オリジンの禁止URLへリダイレクトされた場合は転送先を取得しない", async (t) => {
  const routes = new Map([
    ["https://redirect-source.example/robots.txt", () => robotsResponse("User-agent: *\nAllow: /")],
    ["https://redirect-source.example/start", () => new Response(null, {
      status: 301,
      headers: { location: "https://redirect-target.example/private" }
    })],
    ["https://redirect-target.example/robots.txt", () => robotsResponse("User-agent: *\nDisallow: /private")],
    ["https://redirect-target.example/private", articleResponse]
  ]);
  const calls = installNetworkMock(t, routes);

  const result = await scrapeArticle("https://redirect-source.example/start");

  assert.equal(result.success, false);
  assert.equal(result.reason, "robots_disallowed");
  assert.deepEqual(calls.map((call) => call.url), [
    "https://redirect-source.example/robots.txt",
    "https://redirect-source.example/start",
    "https://redirect-target.example/robots.txt"
  ]);
});

test("リダイレクト先のrobots.txtが404なら記事取得を継続する", async (t) => {
  const routes = new Map([
    ["https://allowed-source.example/robots.txt", () => robotsResponse("User-agent: *\nAllow: /")],
    ["https://allowed-source.example/start", () => new Response(null, {
      status: 307,
      headers: { location: "https://missing-robots.example/article" }
    })],
    ["https://missing-robots.example/robots.txt", () => new Response(null, { status: 404 })],
    ["https://missing-robots.example/article", articleResponse]
  ]);
  const calls = installNetworkMock(t, routes);

  const result = await scrapeArticle("https://allowed-source.example/start");

  assert.equal(result.success, true);
  assert.match(result.contentText, /リダイレクト先から取得した記事本文/);
  assert.equal(result.robotsResult, "fetch_error");
  assert.deepEqual(calls.map((call) => call.url), [
    "https://allowed-source.example/robots.txt",
    "https://allowed-source.example/start",
    "https://missing-robots.example/robots.txt",
    "https://missing-robots.example/article"
  ]);
});

test("robots.txtの5xx・タイムアウト・通信障害では記事を取得しない", async (t) => {
  const timeoutError = new Error("timed out");
  timeoutError.name = "TimeoutError";
  const routes = new Map([
    ["https://robots-5xx.example/robots.txt", () => new Response(null, { status: 503 })],
    ["https://robots-5xx.example/article", articleResponse],
    ["https://robots-timeout.example/robots.txt", () => { throw timeoutError; }],
    ["https://robots-timeout.example/article", articleResponse],
    ["https://robots-network-error.example/robots.txt", () => { throw new Error("connection reset"); }],
    ["https://robots-network-error.example/article", articleResponse]
  ]);
  const calls = installNetworkMock(t, routes);

  const serverErrorResult = await scrapeArticle("https://robots-5xx.example/article");
  const timeoutResult = await scrapeArticle("https://robots-timeout.example/article");
  const networkErrorResult = await scrapeArticle("https://robots-network-error.example/article");

  assert.equal(serverErrorResult.success, false);
  assert.equal(serverErrorResult.reason, "robots_unavailable");
  assert.equal(serverErrorResult.robotsResult, "fetch_error");
  assert.equal(timeoutResult.success, false);
  assert.equal(timeoutResult.reason, "robots_unavailable");
  assert.equal(timeoutResult.robotsResult, "fetch_timeout");
  assert.equal(networkErrorResult.success, false);
  assert.equal(networkErrorResult.reason, "robots_unavailable");
  assert.equal(networkErrorResult.robotsResult, "fetch_error");
  assert.deepEqual(calls.map((call) => call.url), [
    "https://robots-5xx.example/robots.txt",
    "https://robots-timeout.example/robots.txt",
    "https://robots-network-error.example/robots.txt"
  ]);
});

test("同一オリジンの同時検査はrobots.txtを一度だけ取得して各パスを評価する", async (t) => {
  let robotsRequestCount = 0;
  const routes = new Map([
    ["https://robots-cache.example/robots.txt", async () => {
      robotsRequestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return robotsResponse("User-agent: *\nAllow: /");
    }],
    ["https://robots-cache.example/first", articleResponse],
    ["https://robots-cache.example/second", articleResponse]
  ]);
  installNetworkMock(t, routes);

  const [first, second] = await Promise.all([
    scrapeArticle("https://robots-cache.example/first"),
    scrapeArticle("https://robots-cache.example/second")
  ]);

  assert.equal(first.success, true);
  assert.equal(second.success, true);
  assert.equal(robotsRequestCount, 1);
});
