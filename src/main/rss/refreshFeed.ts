import crypto from "node:crypto";
import Parser from "rss-parser";
import type { RefreshFeedResult } from "../../shared/types.js";
import { transformTitlesToBoardStyle } from "../ai/titleTransformer.js";
import {
  listFeedItemsForInitialCaches,
  listUnconvertedFeedItems,
  recordLlmRequestLog,
  recordTitleGenerationAttempts,
  recordRssRefreshRun,
  saveRawThreadTitleFallbacks,
  saveRssThreadSummaries,
  saveThreadTitles,
  upsertFeedItems
} from "../db/repository.js";
import { getFeedSource } from "../db/feedRepository.js";
import { buildThreadTitlePromptHash } from "../prompts/threadTitlePrompt.js";
import { getActiveModel, getTitleGenerationModel } from "../settings/settingsService.js";
import { readResponseText, safeFetch } from "../network/safeFetch.js";
import { selectRecentFeedItems } from "./selectRecentFeedItems.js";
import { runFeedRefreshSingleFlight } from "./feedRefreshSingleFlight.js";

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
const maxFeedBytes = 5 * 1024 * 1024;

export function refreshFeed(
  feedId: string,
  onProgress: (message: string) => void = () => undefined
): Promise<RefreshFeedResult> {
  return runFeedRefreshSingleFlight(feedId, () => refreshFeedOnce(feedId, onProgress));
}

async function refreshFeedOnce(
  feedId: string,
  onProgress: (message: string) => void
): Promise<RefreshFeedResult> {
  const startedAt = new Date().toISOString();
  const feed = getFeedSource(feedId);
  if (!feed) {
    throw new Error(`Feed not found: ${feedId}`);
  }

  try {
    onProgress("RSS取得中...");
    const response = await safeFetch(feed.url, { timeoutMs: 15_000 });
    if (!response.ok) {
      throw new Error(`RSSの取得に失敗しました: HTTP ${response.status}`);
    }
    const { text: feedXml } = await readResponseText(response, maxFeedBytes);
    const parsed = await parser.parseString(feedXml);
    const parsedItems = parsed.items
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
    const items = selectRecentFeedItems(parsedItems);

    const upsertResult = upsertFeedItems(feed.id, items);
    const result: RefreshFeedResult = {
      feedId: upsertResult.feedId,
      fetchedCount: upsertResult.fetchedCount,
      insertedCount: upsertResult.insertedCount,
      updatedCount: upsertResult.updatedCount,
      skippedCount: upsertResult.skippedCount,
      convertedCount: upsertResult.convertedCount,
      conversionFailedCount: upsertResult.conversionFailedCount,
      conversionSkippedCount: upsertResult.conversionSkippedCount,
      fetchedAt: upsertResult.fetchedAt
    };
    const modelToUse = getActiveModel();
    const titleModel = getTitleGenerationModel();
    const titlePromptHash = buildThreadTitlePromptHash(feed.generateTitleFromSummary);
    const initialCacheItems = listFeedItemsForInitialCaches(feed.id);
    saveRawThreadTitleFallbacks(initialCacheItems, titleModel);
    saveRssThreadSummaries(initialCacheItems, modelToUse);

    const unconvertedItems = feed.skipTitleConversion
      ? []
      : listUnconvertedFeedItems(feed.id, titleModel, titlePromptHash);
    if (!feed.skipTitleConversion) {
      onProgress(`スレタイ生成中...（${unconvertedItems.length}件）`);
    }
    const transformed = feed.skipTitleConversion
      ? { titles: [], outcomes: [], logs: [], failedCount: 0, skippedCount: 0 }
      : await transformTitlesToBoardStyle(
        feed.id,
        feed.title,
        unconvertedItems,
        feed.generateTitleFromSummary,
        (completedCount, totalCount) => {
          onProgress(`スレタイ生成中...（${completedCount}/${totalCount}件）`);
        }
      );
    const convertedCount = saveThreadTitles(transformed.titles, titleModel, titlePromptHash);
    recordTitleGenerationAttempts(transformed.outcomes, titleModel, titlePromptHash);

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
