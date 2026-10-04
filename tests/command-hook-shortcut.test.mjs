import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript-api";
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

test("tはレス表示でのみ実行し、入力・IME・修飾キー・連打・ダイアログを除外する", async () => {
  const dom = new JSDOM('<div id="root"></div><input><textarea></textarea><select></select>');
  for (const key of ["window", "document", "HTMLTextAreaElement", "HTMLInputElement", "HTMLSelectElement"]) globalThis[key] = dom.window[key];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let calls = 0;
  const options = {
    threads: [], threadViewMode: "replies", replyBodyRef: { current: null },
    onRunCommandHook: () => calls++
  };
  function Harness() { useKeyboardShortcuts(options); return null; }
  const root = createRoot(document.getElementById("root"));
  async function press(init = {}, target = window) {
    await act(async () => target.dispatchEvent(new window.KeyboardEvent("keydown", { key: "t", bubbles: true, ...init })));
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    await press();
    assert.equal(calls, 1);
    for (const init of [{ repeat: true }, { isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true }, { key: "T" }]) await press(init);
    for (const selector of ["input", "textarea", "select"]) await press({}, document.querySelector(selector));
    assert.equal(calls, 1);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    await press();
    assert.equal(calls, 1);
    dialog.remove();
    options.threadViewMode = "browser";
    await act(async () => root.render(React.createElement(Harness)));
    await press();
    assert.equal(calls, 1);
    options.threadViewMode = "replies";
    await act(async () => root.render(React.createElement(Harness)));
    await press();
    assert.equal(calls, 2);
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const key of ["window", "document", "HTMLTextAreaElement", "HTMLInputElement", "HTMLSelectElement", "IS_REACT_ACT_ENVIRONMENT"]) delete globalThis[key];
  }
});
