import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript-api";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../src/renderer/hooks/useCommandHook.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const moduleSource = outputText.replaceAll('from "react"', `from "${import.meta.resolve("react")}"`);
const { useCommandHook } = await import(`data:text/javascript;base64,${Buffer.from(moduleSource).toString("base64")}`);

test("出力は元の実行に追従し通知を閉じた後は再表示しない", async () => {
  const dom = new JSDOM('<div id="root"></div>');
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let listener;
  let processListener;
  let processUnsubscribed = false;
  let finish;
  let unsubscribed = false;
  window.viperReader = {
    getCommandHook: async () => ({ command: "example-hook", args: ["{url}"] }),
    onCommandHookProcess: (callback) => { processListener = callback; return () => { processUnsubscribed = true; }; },
    onCommandHookOutput: (callback) => { listener = callback; return () => { unsubscribed = true; }; },
    runCommandHook: () => new Promise((resolve) => { finish = resolve; })
  };
  let thread = { id: "first", threadTitle: "First", url: "https://example.com/first" };
  let state;
  function Harness() { state = useCommandHook(thread, "replies"); return null; }
  const root = createRoot(document.getElementById("root"));
  try {
    await act(async () => root.render(React.createElement(Harness)));
    let running;
    await act(async () => { running = state.run(); });
    await act(async () => listener({ threadId: "first", output: "progress" }));
    assert.equal(state.output, "progress");
    const process = { command: "example-hook", pid: 123, status: "running", exitCode: null, signal: null };
    await act(async () => processListener({ threadId: "first", process }));
    assert.deepEqual(state.process, process);
    thread = { id: "second", threadTitle: "Second", url: "https://example.com/second" };
    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => listener({ threadId: "second", output: "unrelated" }));
    assert.equal(state.output, "progress");
    await act(async () => listener({ threadId: "first", output: "next progress" }));
    assert.equal(state.output, "next progress");
    await act(async () => state.clearMessage());
    assert.equal(state.running, true);
    await act(async () => {
      listener({ threadId: "first", output: "late output" });
      processListener({ threadId: "first", process: { ...process, status: "completed", exitCode: 0 } });
      finish();
      await running;
    });
    assert.equal(state.process, null);
    assert.equal(state.message, "");
    assert.equal(state.output, "");
    assert.equal(state.running, false);
    await act(async () => { running = state.run(); });
    await act(async () => listener({ threadId: "second", output: "new output" }));
    assert.equal(state.output, "new output");
    await act(async () => { finish(); await running; });
    assert.match(state.message, /完了: Second/);
    assert.equal(state.output, "new output");
  } finally {
    await act(async () => root.unmount());
    assert.equal(unsubscribed, true);
    assert.equal(processUnsubscribed, true);
    dom.window.close();
    for (const key of ["window", "document", "IS_REACT_ACT_ENVIRONMENT"]) delete globalThis[key];
  }
});
