import type { ThreadPost } from "../../shared/types.js";
import { formatBoardDate } from "./boardDate.js";

export const rawTitlePromptHash = "raw-title-v1";
export const rssSummaryPromptHash = "rss-summary-v1";

export type InitialThreadPostSource = {
  title: string;
  url: string;
  rawSummary: string | null;
};

export function createInitialPosts(item: InitialThreadPostSource, fetchedAt: string): ThreadPost[] {
  return [
    {
      no: 1,
      name: "記事をお送りします＠名無しさん",
      date: formatFetchedAt(fetchedAt),
      id: "RssFetch00",
      body: createFirstPostBody(item.title, item.url, item.rawSummary)
    }
  ];
}

export function createFirstPostBody(title: string, url: string, rawSummary: string | null): string {
  const body = normalizeRssBody(rawSummary);
  return `元記事タイトル:
${title}

URL:
${url}

${body}`;
}

function normalizeRssBody(rawSummary: string | null): string {
  if (!rawSummary?.trim()) {
    return "RSS本文は空。タイトルとURLだけ置いとく。";
  }

  return rawSummary
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[ \u00a0]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatFetchedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return formatBoardDate(date);
}
