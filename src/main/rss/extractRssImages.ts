import { load } from "cheerio";
import type { RssImage } from "../../shared/types.js";

export function extractRssImages(
  rawSummary: string | null,
  articleUrl: string
): RssImage[] {
  if (!rawSummary?.trim()) return [];

  const $ = load(rawSummary, undefined, false);
  const images: RssImage[] = [];
  const seenUrls = new Set<string>();

  $("img[src]").each((_index, element) => {
    const source = $(element).attr("src")?.trim();
    if (!source) return;

    const url = resolveSafeImageUrl(source, articleUrl);
    if (!url || seenUrls.has(url)) return;

    seenUrls.add(url);
    const alt = $(element).attr("alt")?.trim();
    images.push({ url, alt: alt || null });
  });

  return images;
}

function resolveSafeImageUrl(source: string, articleUrl: string): string | null {
  try {
    const url = new URL(source, articleUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.href;
  } catch {
    return null;
  }
}
