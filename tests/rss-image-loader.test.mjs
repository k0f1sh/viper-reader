import assert from "node:assert/strict";
import test from "node:test";

const { readImageDataUrl } = await import("../dist/main/rss/rssImageLoader.js");

test("許可した画像レスポンスをdata URLへ変換する", async () => {
  const response = new Response(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), {
    headers: { "content-type": "image/png; charset=binary" }
  });

  assert.equal(await readImageDataUrl(response, 16), "data:image/png;base64,iVBORw==");
});

test("画像以外のContent-Typeを拒否する", async () => {
  const response = new Response("not an image", {
    headers: { "content-type": "text/html" }
  });

  await assert.rejects(() => readImageDataUrl(response, 1024), /未対応のRSS画像形式/);
});

test("上限を超える画像レスポンスを拒否する", async () => {
  const response = new Response(Uint8Array.from([1, 2, 3, 4]), {
    headers: { "content-type": "image/webp" }
  });

  await assert.rejects(() => readImageDataUrl(response, 3), /画像サイズが上限/);
});
