import { load } from "cheerio";

export function getRssSummary(item: { contentSnippet?: string; summary?: string; content?: string }): string | null {
  const summary = item.contentSnippet ?? item.summary ?? item.content ?? null;
  const html = item.content ?? item.summary;
  if (!html) return summary;

  const $ = load(html);
  const urls = new Set<string>();
  $("a[href]").each((_index, anchor) => {
    try {
      const url = new URL($(anchor).attr("href")!);
      if (url.protocol === "https:" && url.hostname === "news.ycombinator.com"
        && !url.username && !url.password && !url.port
        && url.pathname === "/item" && /^\d+$/.test(url.searchParams.get("id") ?? "")) {
        urls.add(url.href);
      }
    } catch {
      // Ignore malformed links in the feed.
    }
  });

  const missingLinks = [...urls].filter((url) => !summary?.includes(url));
  if (missingLinks.length === 0) return summary;
  return [summary, ...missingLinks.map((url) => `Comments URL: ${url}`)].filter(Boolean).join("\n\n");
}
