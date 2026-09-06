import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

async function loadHook(name) {
  const source = readFileSync(new URL(`../src/renderer/hooks/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText.replaceAll('from "react"', `from "${import.meta.resolve("react")}"`)).toString("base64")}`);
}
const { useThreadSelection } = await loadHook("useThreadSelection");
const { useThreadGeneration } = await loadHook("useThreadGeneration");

test("生成完了した非選択スレッドと、切り替え後に届いた詳細は既読にしない", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const reads = [];
  const pending = [];
  let complete;
  window.viperReader = {
    getThread: (id) => new Promise((resolve) => pending.push({ id, resolve })),
    markThreadPostsRead: async (id, no) => { reads.push([id, no]); },
    onThreadGenerationProgress: () => () => {},
    onThreadGenerationComplete: (callback) => { complete = callback; return () => {}; }
  };
  let selection;
  const noop = () => {};
  const smartViewRef = { current: null };
  function Harness() {
    selection = useThreadSelection({ isArticlePaneEnabled: false, setThreadList: noop,
      onSelectionStarted: noop, onThreadRead: noop, onReadMarkerChange: noop });
    useThreadGeneration({ selectedThreadIdRef: selection.selectedThreadIdRef, smartViewRef,
      setThreadList: noop, setSelectedThread: selection.setSelectedThread,
      reloadGeneratedQueue: noop, reloadQueueSummary: async () => {} });
    return React.createElement("div", null, selection.selectedThread?.id);
  }
  const detail = (id, count) => ({ id, posts: Array.from({ length: count }, (_, i) => ({ no: i + 1 })), readMarkerNo: null });
  const resolve = async (id, count) => {
    const index = pending.findIndex((request) => request.id === id);
    assert.notEqual(index, -1);
    await act(async () => pending.splice(index, 1)[0].resolve(detail(id, count)));
  };
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => selection.setSelectedThreadId("A"));
    await resolve("A", 1);
    await act(async () => selection.setSelectedThreadId("B"));
    await resolve("B", 1);
    await act(async () => complete({ threadId: "A", status: "done" }));
    await resolve("A", 2);
    assert.deepEqual(reads, [["A", 1], ["B", 1]]);
    assert.equal(selection.selectedThread.id, "B");
    await act(async () => selection.setSelectedThreadId("A"));
    await resolve("A", 2);
    assert.deepEqual(reads.at(-1), ["A", 2]);
    await act(async () => selection.setSelectedThreadId("C"));
    await act(async () => selection.setSelectedThreadId("B"));
    await resolve("C", 3);
    assert.equal(reads.some(([id]) => id === "C"), false);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    delete globalThis.requestAnimationFrame;
    delete globalThis.cancelAnimationFrame;
  }
});
