import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/renderer/hooks/usePaneLayout.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
const { parseThreadColumnWidths } = await import(`data:text/javascript;base64,${Buffer.from(outputText.replaceAll('from "react"', `from "${import.meta.resolve("react")}"`)).toString("base64")}`);

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
