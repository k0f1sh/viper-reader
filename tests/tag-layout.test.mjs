import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript-api";

const source = readFileSync(new URL("../src/renderer/hooks/usePaneLayout.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { parseThreadColumnWidths, parsePaneLayout, parseThreadListWidth, normalizeArticlePaneWidth, getArticlePaneResizeWidth } = await import(`data:text/javascript;base64,${Buffer.from(outputText.replaceAll('from "react"', `from "${import.meta.resolve("react")}"`)).toString("base64")}`);

test("V3・V2の既存列幅を保持し、タグ列だけを挿入する", () => {
  const old = [44, 500, 200, 320, 60, 140, 280];
  const expected = [44, 500, 180, 200, 320, 60, 140, 280];
  assert.deepEqual(parseThreadColumnWidths(null, JSON.stringify(old), null), expected);
  assert.deepEqual(parseThreadColumnWidths(null, null, JSON.stringify(old.slice(1))), expected);
  assert.deepEqual(parseThreadColumnWidths(null, null, JSON.stringify(old)), expected);
});

test("V4を優先し、不正設定は旧設定へ、個々の不正幅は既定値へ戻す", () => {
  const current = [44, 500, 240, 200, 320, 60, 140, 280];
  assert.deepEqual(parseThreadColumnWidths(JSON.stringify(current), "[]", null), current);
  assert.deepEqual(parseThreadColumnWidths("broken", JSON.stringify([44, 500, 200, 320, 60, 140, 280]), null), [44, 500, 180, 200, 320, 60, 140, 280]);
  assert.deepEqual(parseThreadColumnWidths('[1,500,2,null,320,60,140,280]', null, null), [44, 500, 100, 170, 320, 60, 140, 280]);
  assert.equal(parseThreadColumnWidths("{}", "[1]", "broken"), null);
});


test("ペイン配置は横配置だけを明示的に復元し、未設定・不正値は既存配置に戻す", () => {
  assert.equal(parsePaneLayout("horizontal"), "horizontal");
  for (const value of [null, "", "stacked", "invalid"]) {
    assert.equal(parsePaneLayout(value), "stacked");
  }
});

test("横配置の分割幅は保存値を復元し、不正値を既定値に、範囲外を境界に戻す", () => {
  assert.equal(parseThreadListWidth("52.5"), 52.5);
  for (const value of [null, "", " ", "invalid", "Infinity", "NaN"]) {
    assert.equal(parseThreadListWidth(value), 40);
  }
  assert.equal(parseThreadListWidth("10"), 25);
  assert.equal(parseThreadListWidth("90"), 65);
});


test("狭い横配置でも記事本文の幅は80px以上で、保存値を復元すると同じ幅になる", () => {
  for (const containerWidth of [120, 210, 300, 600, 1200]) {
    for (const pointerWidth of [-10, 0, 52.5, 80, 150, 360, 1000]) {
      const width = getArticlePaneResizeWidth(pointerWidth, "horizontal", containerWidth);
      assert.ok(width >= 80 && width <= 640);
      assert.equal(normalizeArticlePaneWidth(Number(String(width))), width);
    }
  }
  assert.equal(getArticlePaneResizeWidth(52.5, "horizontal", 210), 80);
  assert.equal(getArticlePaneResizeWidth(1000, "horizontal", 600), 300);
  assert.equal(normalizeArticlePaneWidth(52.5), 80);
  assert.equal(normalizeArticlePaneWidth(NaN), 360);
});

test("上下配置の記事本文は既存の最小幅とレス領域の確保を維持する", () => {
  assert.equal(getArticlePaneResizeWidth(80, "stacked", 1000), 260);
  assert.equal(getArticlePaneResizeWidth(1000, "stacked", 1000), 580);
});
