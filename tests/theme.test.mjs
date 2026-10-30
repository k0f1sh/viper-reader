import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript-api";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

const source = readFileSync(new URL("../src/renderer/hooks/useTheme.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
});
const moduleText = outputText
  .replaceAll('from "react"', `from "${import.meta.resolve("react")}"`)
  .replaceAll('from "../../shared/theme"', `from "${new URL("../dist/shared/theme.js", import.meta.url).href}"`);
const { useTheme } = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);

test("テーマはclassicで開始し、切り替え・再読込・保存失敗時の復元に対応する", async () => {
  const dom = new JSDOM('<html><body><div id="root"></div></body></html>');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  Object.defineProperty(globalThis, "window", { configurable: true, value: dom.window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let stored = null;
  let failSave = false;
  let failLoad = false;
  let current;
  dom.window.viperReader = {
    getUserSetting: async (key) => {
      assert.equal(key, "theme");
      if (failLoad) throw new Error("load failed");
      return stored;
    },
    saveUserSetting: async (key, value) => {
      assert.equal(key, "theme");
      if (failSave) throw new Error("save failed");
      stored = value;
    }
  };
  function Harness() { current = useTheme(); return null; }
  const root = createRoot(dom.window.document.getElementById("root"));
  let version = 0;
  async function mount() {
    await act(async () => root.render(createElement(Harness, { key: version++ })));
  }
  const applied = () => dom.window.document.documentElement.dataset.theme;
  try {
    await mount();
    assert.equal(current.theme, "classic");
    assert.equal(applied(), "classic");
    await act(async () => current.changeTheme("modern"));
    assert.equal(applied(), "modern");
    assert.equal(stored, "modern");
    await mount();
    assert.equal(applied(), "modern");
    await act(async () => current.changeTheme("dark"));
    assert.equal(applied(), "dark");
    assert.equal(stored, "dark");
    await mount();
    assert.equal(applied(), "dark");
    await act(async () => current.changeTheme("blue"));
    assert.equal(applied(), "blue");
    assert.equal(stored, "blue");
    await mount();
    assert.equal(applied(), "blue");
    failSave = true;
    await act(async () => current.changeTheme("classic"));
    assert.equal(applied(), "blue");
    assert.equal(stored, "blue");
    failSave = false;
    await act(async () => current.changeTheme("modern"));
    failSave = true;
    await act(async () => current.changeTheme("classic"));
    assert.equal(applied(), "modern");
    assert.equal(stored, "modern");
    assert.ok(current.error);
    assert.equal(current.isBusy, false);
    failSave = false;
    await act(async () => current.changeTheme("classic"));
    assert.equal(applied(), "classic");
    assert.equal(stored, "classic");
    assert.equal(current.error, "");
    await mount();
    assert.equal(applied(), "classic");
    stored = "unknown";
    await mount();
    assert.equal(applied(), "classic");
    failLoad = true;
    await mount();
    assert.equal(applied(), "classic");
    assert.ok(current.error);
    await act(async () => current.changeTheme("modern"));
    assert.equal(stored, "modern");
    assert.equal(current.error, "");
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [name, descriptor] of [["window", previousWindow], ["document", previousDocument]]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});
