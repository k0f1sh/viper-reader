import assert from "node:assert/strict";
import test from "node:test";

const { extractRssImages } = await import("../dist/main/rss/extractRssImages.js");

test("RSS本文の画像URLと代替テキストを出現順に抽出する", () => {
  const images = extractRssImages(
    `<p>本文</p>
     <img src="https://cdn.example.com/first.webp" alt="最初の画像">
     <img src="/images/second.jpg" alt="  2枚目  ">`,
    "https://example.com/posts/1"
  );

  assert.deepEqual(images, [
    { url: "https://cdn.example.com/first.webp", alt: "最初の画像" },
    { url: "https://example.com/images/second.jpg", alt: "2枚目" }
  ]);
});

test("同じ画像の重複を除き、altが空ならnullにする", () => {
  const images = extractRssImages(
    `<img src="https://example.com/image.png">
     <img src="https://example.com/image.png" alt="重複">`,
    "https://example.com/article"
  );

  assert.deepEqual(images, [{ url: "https://example.com/image.png", alt: null }]);
});

test("HTTP以外のURLと壊れたURLを除外する", () => {
  const images = extractRssImages(
    `<img src="data:image/png;base64,AAAA">
     <img src="javascript:alert(1)">
     <img src="https://[invalid/image.png">
     <img src="https://example.com/safe.png">`,
    "https://example.com/article"
  );

  assert.deepEqual(images, [{ url: "https://example.com/safe.png", alt: null }]);
});

test("RSS本文が空なら画像なしとして扱う", () => {
  assert.deepEqual(extractRssImages(null, "https://example.com/article"), []);
  assert.deepEqual(extractRssImages("  ", "https://example.com/article"), []);
});
