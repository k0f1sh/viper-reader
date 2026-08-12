import { useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { FeedSource, ThreadListItem } from "../../shared/types";
import { allFeedsId } from "./useFeedTree";

const maxConcurrentFeedRefreshes = 5;

type UseFeedRefreshOptions = {
  feeds: FeedSource[];
  threads: ThreadListItem[];
  selectedFeedId: string;
  selectedThreadIdRef: MutableRefObject<string | undefined>;
  reloadFeeds: () => Promise<void>;
  reloadCurrentThreadList: (preferredThreadId?: string) => Promise<void>;
};

export function useFeedRefresh(options: UseFeedRefreshOptions) {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const optionsRef = useRef(options);
  optionsRef.current = options;

  async function refreshFeed(feedId: string) {
    const current = optionsRef.current;
    if (!window.viperReader || !feedId || isRefreshing) return;
    const preferredThreadId = current.threads.some(
      (thread) => thread.feedId === feedId && thread.id === current.selectedThreadIdRef.current
    ) ? current.selectedThreadIdRef.current : undefined;

    setIsRefreshing(true);
    setMessage("RSS取得中...");
    const unsubscribe = window.viperReader.onRefreshProgress((progress) => {
      if (progress.feedId === feedId) setMessage(progress.message);
    });
    try {
      const result = await window.viperReader.refreshFeed(feedId);
      await current.reloadFeeds();
      await current.reloadCurrentThreadList(preferredThreadId);
      setMessage(`取得:${result.fetchedCount} 新規:${result.insertedCount} 更新:${result.updatedCount} 既存:${result.skippedCount} 変換:${result.convertedCount} 失敗:${result.conversionFailedCount} 未変換:${result.conversionSkippedCount}`);
    } catch (error) {
      setMessage(error instanceof Error ? `取得失敗: ${error.message}` : "取得失敗");
    } finally {
      unsubscribe();
      setIsRefreshing(false);
    }
  }

  async function refreshAllFeeds() {
    const current = optionsRef.current;
    if (!window.viperReader || current.feeds.length === 0 || isRefreshing) return;
    const feedsToRefresh = [...current.feeds];
    const totals = { fetchedCount: 0, insertedCount: 0, updatedCount: 0, skippedCount: 0, convertedCount: 0, conversionFailedCount: 0, conversionSkippedCount: 0 };
    const failedFeeds: string[] = [];
    const feedById = new Map(feedsToRefresh.map((feed) => [feed.id, feed]));
    let nextFeedIndex = 0;
    let completedFeedCount = 0;

    setIsRefreshing(true);
    setMessage(`全板更新を開始...（0/${feedsToRefresh.length}板・最大${maxConcurrentFeedRefreshes}並列）`);
    const unsubscribe = window.viperReader.onRefreshProgress((progress) => {
      const feed = feedById.get(progress.feedId);
      if (feed) setMessage(`全板更新 完了${completedFeedCount}/${feedsToRefresh.length}板「${feed.title}」: ${progress.message}`);
    });
    try {
      async function refreshNext(): Promise<void> {
        while (nextFeedIndex < feedsToRefresh.length) {
          const feed = feedsToRefresh[nextFeedIndex++];
          setMessage(`全板更新 完了${completedFeedCount}/${feedsToRefresh.length}板「${feed.title}」: RSS取得中...`);
          try {
            const result = await window.viperReader!.refreshFeed(feed.id);
            totals.fetchedCount += result.fetchedCount;
            totals.insertedCount += result.insertedCount;
            totals.updatedCount += result.updatedCount;
            totals.skippedCount += result.skippedCount;
            totals.convertedCount += result.convertedCount;
            totals.conversionFailedCount += result.conversionFailedCount;
            totals.conversionSkippedCount += result.conversionSkippedCount;
          } catch {
            failedFeeds.push(feed.title);
          } finally {
            completedFeedCount += 1;
            setMessage(`全板更新 ${completedFeedCount}/${feedsToRefresh.length}板完了`);
          }
        }
      }
      await Promise.all(Array.from(
        { length: Math.min(maxConcurrentFeedRefreshes, feedsToRefresh.length) },
        () => refreshNext()
      ));
      await current.reloadFeeds();
      await current.reloadCurrentThreadList(current.selectedThreadIdRef.current);
      const failures = failedFeeds.length ? ` 更新失敗:${failedFeeds.length}板（${failedFeeds.join("、")}）` : "";
      setMessage(`全${feedsToRefresh.length}板完了 取得:${totals.fetchedCount} 新規:${totals.insertedCount} 更新:${totals.updatedCount} 既存:${totals.skippedCount} 変換:${totals.convertedCount} 失敗:${totals.conversionFailedCount} 未変換:${totals.conversionSkippedCount}${failures}`);
    } finally {
      unsubscribe();
      setIsRefreshing(false);
    }
  }

  async function refreshSelectedFeed() {
    const { selectedFeedId } = optionsRef.current;
    if (selectedFeedId === allFeedsId) await refreshAllFeeds();
    else if (selectedFeedId) await refreshFeed(selectedFeedId);
  }

  return { isRefreshing, message, clearMessage: () => setMessage(""), refreshFeed, refreshSelectedFeed };
}
