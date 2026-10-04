import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { GoogleGenAI } from "@google/genai";
import { generateJson, generateText } from "../dist/main/ai/genaiClient.js";
const request = { model: "test", purpose: "thread_response", contents: "test", parse: JSON.parse };
const fake = (generateContent) => ({ apiKey: "test", generateContent });
function heldTransport() {
  let active = 0;
  let maxActive = 0;
  const calls = [];
  return {
    calls,
    get active() { return active; },
    get maxActive() { return maxActive; },
    transport: fake(({ config }) => new Promise((resolve, reject) => {
      active++;
      maxActive = Math.max(maxActive, active);
      let settled = false;
      calls.push({ signal: config.abortSignal, finish(error) {
        if (settled) return;
        settled = true;
        active--;
        if (error) reject(error); else resolve({ text: '{"ok":true}' });
      } });
    }))
  };
}

test("タイムアウト後の再試行も、abortを無視する通信が終わるまで5枠を超えない", async () => {
  const held = heldTransport();
  const first = Array.from({ length: 5 }, () => generateJson({ ...request, timeoutMs: 10 }, held.transport));
  const timedOut = await Promise.all(first);
  assert.ok(timedOut.every((result) => /タイムアウト/.test(result.errorMessage)));
  assert.equal(held.active, 5);
  assert.ok(held.calls.every((call) => call.signal.aborted));
  const retries = Array.from({ length: 5 }, (_, index) => index % 2
    ? generateText(request, held.transport)
    : generateJson(request, held.transport));
  await tick();
  assert.equal(held.calls.length, 5);
  // Late successes and late rejections both release their slots exactly once.
  held.calls.slice(0, 5).forEach((call, index) => call.finish(index % 2 ? new Error("late failure") : undefined));
  await tick();
  assert.equal(held.calls.length, 10);
  assert.equal(held.maxActive, 5);
  held.calls.slice(5).forEach((call) => call.finish());
  assert.ok((await Promise.all(retries)).every((result) => result.errorMessage === null));
  assert.equal(held.active, 0);
});

test("待機のタイムアウト・キャンセルでは通信を開始せず、待機列から取り除く", async () => {
  const held = heldTransport();
  const running = Array.from({ length: 5 }, () => generateJson(request, held.transport));
  await tick();
  const controller = new AbortController();
  const cancelled = generateText({ ...request, signal: controller.signal }, held.transport);
  const expired = generateJson({ ...request, queueTimeoutMs: 10 }, held.transport);
  controller.abort();
  assert.match((await cancelled).errorMessage, /キャンセル/);
  assert.match((await expired).errorMessage, /待機がタイムアウト/);
  held.calls.forEach((call) => call.finish());
  await Promise.all(running);
  await tick();
  assert.equal(held.calls.length, 5);
  const next = generateText(request, held.transport);
  await tick();
  held.calls.at(-1).finish();
  assert.equal((await next).errorMessage, null);
});

test("待機列は50件まで受理し、満杯と事前キャンセルをエラー結果で返す", async () => {
  const held = heldTransport();
  const running = Array.from({ length: 5 }, () => generateJson(request, held.transport));
  await tick();
  const controllers = Array.from({ length: 50 }, () => new AbortController());
  const queued = controllers.map((controller) => generateJson({ ...request, signal: controller.signal }, held.transport));
  assert.match((await generateText(request, held.transport)).errorMessage, /待機件数が上限/);
  controllers.forEach((controller) => controller.abort());
  assert.ok((await Promise.all(queued)).every((result) => /キャンセル/.test(result.errorMessage)));
  assert.match((await generateJson({ ...request, signal: controllers[0].signal }, held.transport)).errorMessage, /キャンセル/);
  held.calls.forEach((call) => call.finish());
  await Promise.all(running);
  assert.equal(held.calls.length, 5);
});

test("実行中の外部キャンセルもSDKへ伝え、通信終了まで枠を保持する", async () => {
  const held = heldTransport();
  const controller = new AbortController();
  const pending = generateText({ ...request, signal: controller.signal }, held.transport);
  await tick();
  controller.abort();
  assert.match((await pending).errorMessage, /キャンセル/);
  assert.equal(held.calls[0].signal.aborted, true);
  assert.equal(held.active, 1);
  held.calls[0].finish();
  await tick();
  assert.equal(held.active, 0);
});

test("同期throwでも枠を戻し、後続を処理できる", async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () =>
    generateJson(request, fake(() => { throw new Error("synchronous failure"); }))));
  assert.ok(results.every((result) => result.errorMessage === "synchronous failure"));
  assert.equal((await generateText(request, fake(async () => ({ text: "ok" })))).text, "ok");
});

test("インストール済みGoogle SDKを通してfetchまでタイムアウトのabortが届く", async () => {
  const originalFetch = globalThis.fetch;
  let fetchSignal;
  let fetchStopped = false;
  globalThis.fetch = (_url, options) => new Promise((_, reject) => {
    fetchSignal = options.signal;
    const stop = () => { fetchStopped = true; reject(new DOMException("aborted", "AbortError")); };
    if (fetchSignal.aborted) stop();
    else fetchSignal.addEventListener("abort", stop, { once: true });
  });
  try {
    const ai = new GoogleGenAI({ apiKey: "test" });
    const result = await generateText({ ...request, timeoutMs: 30 }, fake(ai.models.generateContent.bind(ai.models)));
    assert.match(result.errorMessage, /タイムアウト/);
    assert.equal(fetchSignal.aborted, true);
    assert.equal(fetchStopped, true);
    await tick();
  } finally { globalThis.fetch = originalFetch; }
});
