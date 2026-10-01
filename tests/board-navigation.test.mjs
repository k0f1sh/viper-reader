import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

const allFeedsId = "__all_feeds__";
const source = readFileSync(new URL("../src/renderer/hooks/useKeyboardShortcuts.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const moduleSource = outputText.replaceAll('from "../../shared/boardPolicy"', `from "${new URL("../dist/shared/boardPolicy.js", import.meta.url).href}"`).replaceAll('from "react"', `from "${import.meta.resolve("react")}"`)
  .replace('import { allFeedsId } from "./useFeedTree";', `const allFeedsId = ${JSON.stringify(allFeedsId)};`);
const { useKeyboardShortcuts } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);

test("h/lは表示中の特別板・キュー・RSSの順をたどり、非表示の板を飛ばす", async () => {
  const dom = new JSDOM('<div class="feed-tree"></div><div id="root"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  globalThis.HTMLInputElement = dom.window.HTMLInputElement;
  globalThis.HTMLSelectElement = dom.window.HTMLSelectElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const tree = document.querySelector(".feed-tree");
  // Nested RSS boards can appear in a different order from the database list.
  const visibleIds = ["board:local", "__unread_queue__", "__generated_queue__", "__reviewed_queue__", allFeedsId, "rss:nested", "rss:root"];
  for (const id of visibleIds) {
    const button = document.createElement("button");
    button.dataset.navigationId = id;
    tree.append(button);
  }
  const folder = document.createElement("button");
  folder.textContent = "閉じたフォルダ";
  tree.append(folder);
  const selected = [];
  const noop = () => {};
  const options = {
    feeds: [{ id: "rss:hidden" }, { id: "rss:root" }, { id: "board:local" }, { id: "rss:nested" }],
    threads: [], selectedThreadId: undefined, selectedThread: null, selectedFeedId: "rss:nested", smartView: null,
    threadViewMode: "replies", isArticleBrowserExpanded: false, extractedPostId: null, replyBodyRef: { current: null },
    onSelectFeed: (id) => { options.selectedFeedId = id; options.smartView = null; selected.push(id); },
    onSelectSmartView: (view) => { options.smartView = view; selected.push(`__${view}_queue__`); },
    onSelectThread: noop, onMoveToNextPage: noop, onMoveToPreviousPage: noop,
    onRefresh: noop, onGenerateResponses: noop, onGenerateReplies: noop, onToggleFavorite: noop,
    onToggleThreadRead: noop, onToggleThreadView: noop, onToggleArticleBrowserExpanded: noop,
    onFocusWritePanel: noop, onClearExtractedPost: noop
  };
  function Harness() { useKeyboardShortcuts(options); return null; }
  const root = createRoot(document.getElementById("root"));
  async function press(key) {
    await act(async () => window.dispatchEvent(new window.KeyboardEvent("keydown", { key, bubbles: true })));
    await act(async () => root.render(React.createElement(Harness)));
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    for (const key of ["h", "H", "h", "h", "h"]) await press(key);
    assert.deepEqual(selected, [allFeedsId, "__reviewed_queue__", "__generated_queue__", "__unread_queue__", "board:local"]);
    await press("h");
    assert.equal(selected.length, 5);
    for (let i = 0; i < 6; i++) await press(i % 2 ? "L" : "l");
    assert.deepEqual(selected.slice(5), visibleIds.slice(1));
    await press("l");
    assert.equal(selected.length, 11);
    // A folder collapse removes its board from the visible navigation order immediately.
    tree.querySelector('[data-navigation-id="rss:nested"]').remove();
    await press("h");
    assert.equal(selected.at(-1), allFeedsId);
    // Text input and dialogs retain their normal keyboard behavior.
    const input = document.createElement("input");
    document.body.append(input);
    const before = selected.length;
    await act(async () => input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "h", bubbles: true })));
    assert.equal(selected.length, before);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    await press("h");
    assert.equal(selected.length, before);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const key of ["window", "document", "HTMLTextAreaElement", "HTMLInputElement", "HTMLSelectElement", "IS_REACT_ACT_ENVIRONMENT"]) delete globalThis[key];
  }
});
