import type { RssImageContent } from "../../shared/types.js";
import { getDatabase } from "../db/database.js";
import { ARTICLE_FETCH_USER_AGENT } from "../network/httpIdentity.js";
import { safeFetch } from "../network/safeFetch.js";
import { extractRssImages } from "./extractRssImages.js";

export const maxRssImageBytes = 8 * 1024 * 1024;
export const maxRssImagesPerThread = 12;
const allowedImageTypes = new Set([
  "image/avif",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp"
]);

export async function loadRssImage(threadId: string, imageIndex: number): Promise<RssImageContent | null> {
  if (!Number.isInteger(imageIndex) || imageIndex < 0 || imageIndex >= maxRssImagesPerThread) {
    throw new Error("RSS画像番号が範囲外です。");
  }
  const row = getDatabase()
    .prepare("SELECT url, raw_summary FROM feed_items WHERE id = ?")
    .get(threadId) as { url: string; raw_summary: string | null } | undefined;
  if (!row) return null;

  const image = extractRssImages(row.raw_summary, row.url)[imageIndex];
  if (!image) return null;

  const response = await safeFetch(image.url, {
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9",
      "User-Agent": ARTICLE_FETCH_USER_AGENT
    },
    timeoutMs: 15_000
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`RSS画像の取得に失敗しました: HTTP ${response.status}`);
  }

  return {
    ...image,
    dataUrl: await readImageDataUrl(response, maxRssImageBytes)
  };
}

export async function readImageDataUrl(response: Response, maxBytes: number): Promise<string> {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!contentType || !allowedImageTypes.has(contentType)) {
    await response.body?.cancel();
    throw new Error(`未対応のRSS画像形式です: ${contentType || "Content-Typeなし"}`);
  }

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new Error(`RSS画像サイズが上限の ${maxBytes} バイトを超えています。`);
  }
  if (!response.body) throw new Error("RSS画像のレスポンスが空です。");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        throw new Error(`RSS画像サイズが上限の ${maxBytes} バイトを超えています。`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return `data:${contentType};base64,${Buffer.concat(chunks).toString("base64")}`;
}
