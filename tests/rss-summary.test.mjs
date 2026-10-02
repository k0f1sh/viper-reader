import assert from "node:assert/strict";
import test from "node:test";
import Parser from "rss-parser";
import { getRssSummary } from "../dist/main/rss/rssSummary.js";
import { createFirstPostBody } from "../dist/main/threads/initialThreadPosts.js";
import { sanitizeRssHtml } from "../dist/main/rss/sanitizeRssHtml.js";
import { JSDOM } from "jsdom";

test("HN comment href survives RSS snippet conversion and appears in post 1", async () => {
  const feed = await new Parser().parseString(`<rss version="2.0"><channel><title>HN</title><item>
    <title>Article</title><link>https://example.com/article</link>
    <description><![CDATA[<a href="https://news.ycombinator.com/item?id=123">Comments</a>]]></description>
  </item></channel></rss>`);
  const item = feed.items[0];
  assert.equal(item.contentSnippet, "Comments");
  const summary = getRssSummary(item);
  assert.match(createFirstPostBody(item.title, item.link, summary), /コメントURL:\nhttps:\/\/news\.ycombinator\.com\/item\?id=123/);
});

test("RSS HTML keeps formatting and links while removing executable and fetching content", () => {
  const dirty = `<p id="post-2" style="color:red" onclick="alert(1)">概要<br><strong>強調</strong><em>斜体</em><code>x &lt; 2</code></p>
    <a href="https://news.ycombinator.com/item?id=123" target="_blank" ping="https://tracker.example">Comments</a>
    <a href="/relative">相対リンク</a><a>URLなし</a>
    <script>alert(1)</script><style>body{display:none}</style><iframe src="https://tracker.example"></iframe>
    <img src="https://tracker.example" onerror="alert(1)"><svg><a href="https://tracker.example">SVG</a></svg>
    <form><input autofocus onfocus="alert(1)"></form>`;
  const html = sanitizeRssHtml(dirty, "https://example.com/article");
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector("a").textContent, "Comments");
  assert.equal(document.querySelector("a").href, "https://news.ycombinator.com/item?id=123");
  assert.equal(document.querySelectorAll("a")[1].href, "https://example.com/relative");
  assert.equal(document.querySelectorAll("a")[2].hasAttribute("href"), false);
  assert.equal(document.querySelector("code").textContent, "x < 2");
  const tags = new Set(["A", "P", "BR", "STRONG", "EM", "CODE", "UL", "OL", "LI", "PRE", "DIV", "BLOCKQUOTE"]);
  for (const element of document.body.querySelectorAll("*")) {
    assert.ok(tags.has(element.tagName));
    for (const attribute of element.attributes) assert.ok(element.tagName === "A" && attribute.name === "href");
  }
  assert.doesNotMatch(html, /alert\(1\)|display:none|tracker\.example|SVG/);
  assert.equal(sanitizeRssHtml(html, "https://example.com/article"), html);
});

test("dangerous and obfuscated URL schemes cannot survive sanitization", () => {
  for (const href of ["javascript:alert(1)", "jav&#x61;script:alert(1)", "java&#10;script:alert(1)", "data:text/html,test", "file:///tmp/test", "mailto:test@example.com", "https://user:password@example.com/"]) {
    const html = sanitizeRssHtml(`<a href="${href}">link</a>`, "https://example.com/article");
    assert.equal(new JSDOM(html).window.document.querySelector("a").hasAttribute("href"), false, href);
  }
});

test("list items, blocks, and preformatted code retain their boundaries without attributes", () => {
  const html = sanitizeRssHtml('<ul style="color:red"><li>first</li><li>second</li></ul><ol><li>third</li></ol><div>A</div><div>B</div><blockquote>引用</blockquote><pre onclick="alert(1)">const a = 1;\n  const b = 2;</pre>', "https://example.com");
  const document = new JSDOM(html).window.document;
  assert.deepEqual([...document.querySelectorAll("li")].map((node) => node.textContent), ["first", "second", "third"]);
  assert.equal(document.querySelectorAll("div").length, 2);
  assert.equal(document.querySelector("pre").textContent, "const a = 1;\n  const b = 2;");
  assert.equal(document.querySelector("blockquote").textContent, "引用");
  assert.doesNotMatch(html, /style=|onclick=/);
});

test("plain summaries stay intact and existing comment URLs are not duplicated", () => {
  assert.equal(getRssSummary({ contentSnippet: "普通の概要" }), "普通の概要");
  assert.equal(getRssSummary({}), null);
  const url = "https://news.ycombinator.com/item?id=123";
  assert.equal(getRssSummary({ contentSnippet: `Comments URL: ${url}`, content: `<a href="${url}">Comments</a>` }), `Comments URL: ${url}`);
  assert.equal(getRssSummary({ contentSnippet: "Comments", content: '<a href="https://example.com/item?id=123">Comments</a>' }), "Comments");
});
