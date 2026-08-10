import type { FeedSource } from "./types.js";

export const seedFeeds: FeedSource[] = [
  {
    id: "1",
    title: "はてなブックマーク 人気エントリー IT・プログラミング",
    url: "https://b.hatena.ne.jp/hotentry/it.rss",
    unreadCount: 0,
    generateTitleFromSummary: false,
    skipTitleConversion: false,
    lastFetchedAt: null
  },
  {
    id: "2",
    title: "Hacker News",
    url: "https://news.ycombinator.com/rss",
    unreadCount: 0,
    generateTitleFromSummary: false,
    skipTitleConversion: false,
    lastFetchedAt: null
  },
];
