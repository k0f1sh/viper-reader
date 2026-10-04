import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript-api";
import { JSDOM } from "jsdom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createElement } from "react";
import { sanitizeRssHtml } from "../dist/main/rss/sanitizeRssHtml.js";

const source = readFileSync(new URL("../src/renderer/components/PostBody.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
});
const moduleText = outputText
  .replaceAll('from "react"', `from "${import.meta.resolve("react")}"`)
  .replaceAll('from "react/jsx-runtime"', `from "${import.meta.resolve("react/jsx-runtime")}"`)
  .replaceAll('from "../../shared/postBody"', `from "${new URL("../dist/shared/postBody.js", import.meta.url).href}"`);
const { PostBody } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);

test("RSS text URLs remain clickable and copyable while lists and code render correctly", async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.example" });
  const names = ["window", "document", "Node", "HTMLElement", "HTMLAnchorElement", "DOMParser"];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const opened = [];
  const copied = [];
  dom.window.viperReader = { openExternalUrl: async (url) => opened.push(url), copyText: async (url) => copied.push(url) };
  const root = createRoot(dom.window.document.getElementById("root"));
  try {
    const html = sanitizeRssHtml('詳細 https://example.com/docs を参照\n次の行<p><strong>https://example.com/more</strong></p><a href="https://news.ycombinator.com/item?id=123">Comments</a><ul><li>first</li><li>second</li></ul><pre>const a = 1;\n  const b = 2;\nhttps://example.com/code</pre>', "https://example.com/article");
    await act(async () => root.render(createElement(PostBody, {
      body: "fallback", rssContent: { header: "記事\n\n", html }, showUrlCopyButton: true, onAnchorClick: () => {}
    })));
    const content = dom.window.document.querySelector(".rss-post-content");
    const urls = [...content.querySelectorAll("button.post-link")];
    assert.deepEqual(urls.map((node) => node.textContent), ["https://example.com/docs", "https://example.com/more"]);
    await act(async () => urls[0].click());
    await act(async () => content.querySelector(".post-url-copy-button").click());
    assert.deepEqual(copied, ["https://example.com/docs"]);
    assert.match(content.querySelector(".post-url-copy-button").getAttribute("aria-label"), /コピーしました/);
    await act(async () => content.querySelector("a").click());
    assert.deepEqual(opened, ["https://example.com/docs", "https://news.ycombinator.com/item?id=123"]);
    assert.deepEqual([...content.querySelectorAll("li")].map((node) => node.textContent), ["first", "second"]);
    assert.equal(content.querySelector("pre").textContent, "const a = 1;\n  const b = 2;\nhttps://example.com/code");
    assert.equal(content.querySelector("pre button"), null);
    assert.match(content.textContent, /を参照\n次の行/);
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    assert.match(css, /\.rss-post-content\s*\{[^}]*white-space:\s*pre-wrap/);
    assert.match(css, /\.rss-post-content pre\s*\{[^}]*white-space:\s*pre-wrap/);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const name of names) {
      const descriptor = previous.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});
