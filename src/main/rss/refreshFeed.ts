import crypto from "node:crypto";
import Parser from "rss-parser";
import type { RefreshFeedResult } from "../../shared/types.js";
import { transformTitlesToVipStyle } from "../ai/titleTransformer.js";
import {
  getFeedSource,
  listUnconvertedFeedItems,
  recordLlmRequestLog,
  recordRssRefreshRun,
  saveVipTitles,
  upsertFeedItems,
  getActiveModel
} from "../db/repository.js";
import { vipTitlePromptHash } from "../prompts/vipTitlePrompt.js";

type ParsedItem = {
  id: string;
  feedId: string;
  guid: string | null;
  title: string;
  url: string;
  publishedAt: string | null;
  rawSummary: string | null;
};

const parser = new Parser();

export async function refreshFeed(
  feedId: string,
  onProgress: (message: string) => void = () => undefined
): Promise<RefreshFeedResult> {
  const startedAt = new Date().toISOString();
  const feed = getFeedSource(feedId);
  if (!feed) {
    throw new Error(`Feed not found: ${feedId}`);
  }

  try {
    onProgress("RSS取得中...");
    const parsed = await parser.parseURL(feed.url);
    const items = parsed.items
      .map((item): ParsedItem | null => {
        const url = item.link?.trim();
        const title = item.title?.trim();
        if (!url || !title) {
          return null;
        }

        const guid = item.guid?.trim() || url;

        return {
          id: createFeedItemId(feed.id, guid),
          feedId: feed.id,
          guid,
          title,
          url,
          publishedAt: normalizeDate(item.isoDate ?? item.pubDate),
          rawSummary: item.contentSnippet ?? item.summary ?? item.content ?? null
        };
      })
      .filter((item): item is ParsedItem => item !== null);

    const result = upsertFeedItems(feed.id, items);
    const modelToUse = getActiveModel();
    const unconvertedItems = listUnconvertedFeedItems(feed.id, modelToUse, vipTitlePromptHash);
    onProgress("スレタイ生成中...");
    const transformed = await transformTitlesToVipStyle(feed.id, feed.title, unconvertedItems);
    const convertedCount = saveVipTitles(transformed.titles, modelToUse, vipTitlePromptHash);

    for (const log of transformed.logs) {
      recordLlmRequestLog(log);
    }

    const finalResult = {
      ...result,
      convertedCount,
      conversionFailedCount: transformed.failedCount + (transformed.titles.length - convertedCount),
      conversionSkippedCount: transformed.skippedCount
    };
    const finishedAt = new Date().toISOString();
    recordRssRefreshRun({
      ...finalResult,
      id: createRunId(feed.id, finishedAt),
      feedUrl: feed.url,
      status: "success",
      errorMessage: null,
      startedAt,
      finishedAt
    });

    return finalResult;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    recordRssRefreshRun({
      id: createRunId(feed.id, finishedAt),
      feedId: feed.id,
      feedUrl: feed.url,
      status: "error",
      fetchedCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      convertedCount: 0,
      conversionFailedCount: 0,
      conversionSkippedCount: 0,
      errorMessage: error instanceof Error ? error.message : String(error),
      startedAt,
      finishedAt
    });
    throw error;
  }
}

function createFeedItemId(feedId: string, value: string): string {
  const hash = crypto.createHash("sha1").update(`${feedId}:${value}`).digest("hex").slice(0, 16);
  return `${feedId}:${hash}`;
}

function normalizeDate(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString();
}

function createRunId(feedId: string, value: string): string {
  const hash = crypto
    .createHash("sha1")
    .update(`rss:${feedId}:${value}:${crypto.randomUUID()}`)
    .digest("hex")
    .slice(0, 20);
  return `rss:${hash}`;
}
