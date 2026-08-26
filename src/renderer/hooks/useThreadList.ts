import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { ReadingQueueSummary, SmartView, ThreadListItem } from "../../shared/types";
import { allFeedsId } from "./useFeedTree";

type UseThreadListOptions = {
  selectedFeedId: string;
  selectedFeedIdRef: MutableRefObject<string>;
  onClearSelection: () => void;
  onSelectPreferredThread: (threadId: string) => void;
  onReloadFeeds: () => Promise<void>;
  onSelectedThreadReadChange: (threadId: string, isRead: boolean) => void;
};

const emptyQueueSummary: ReadingQueueSummary = {
  unreadCount: 0,
  queuedCount: 0,
  generatingCount: 0,
  completedCount: 0,
  reviewedCount: 0
};

export function useThreadList({
  selectedFeedId,
  selectedFeedIdRef,
  onClearSelection,
  onSelectPreferredThread,
  onReloadFeeds,
  onSelectedThreadReadChange
}: UseThreadListOptions) {
  const [threads, setThreads] = useState<ThreadListItem[]>([]);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [smartView, setSmartView] = useState<SmartView | null>(null);
  const [queueSummary, setQueueSummary] = useState<ReadingQueueSummary>(emptyQueueSummary);
  const requestIdRef = useRef(0);
  const threadsRef = useRef<ThreadListItem[]>([]);
  const callbacksRef = useRef({
    onClearSelection,
    onSelectPreferredThread,
    onReloadFeeds,
    onSelectedThreadReadChange
  });
  const smartViewRef = useRef<SmartView | null>(null);
  const effectiveUnreadOnlyRef = useRef(false);
  callbacksRef.current = { onClearSelection, onSelectPreferredThread, onReloadFeeds, onSelectedThreadReadChange };
  smartViewRef.current = smartView;
  threadsRef.current = threads;

  const isUnreadOnlyLocked = selectedFeedId === allFeedsId && smartView === null;
  const effectiveShowUnreadOnly = smartView === "unread"
    || (smartView === null && !isUnreadOnlyLocked && showUnreadOnly);
  effectiveUnreadOnlyRef.current = effectiveShowUnreadOnly;

  async function reloadThreads(feedId: string, preferredThreadId?: string, nextPage = page) {
    if (!window.viperReader) return;
    const requestId = ++requestIdRef.current;
    const result = await window.viperReader.listThreads(
      feedId === allFeedsId ? null : feedId,
      nextPage,
      effectiveUnreadOnlyRef.current
    );
    if (requestId !== requestIdRef.current) return;
    setThreads(result.items);
    setPage(result.page);
    setTotalCount(result.totalCount);
    if (preferredThreadId && result.items.some((thread) => thread.id === preferredThreadId)) {
      callbacksRef.current.onSelectPreferredThread(preferredThreadId);
    }
  }

  async function reloadGenerated(nextPage = page, preserveCurrent = false) {
    if (!window.viperReader) return;
    const requestId = ++requestIdRef.current;
    const result = await window.viperReader.listGeneratedQueue(nextPage);
    if (requestId !== requestIdRef.current) return;
    if (preserveCurrent) {
      const refreshedById = new Map(result.items.map((thread) => [thread.id, thread]));
      const retained = threadsRef.current.map((thread) => refreshedById.get(thread.id) ?? thread);
      const retainedIds = new Set(retained.map((thread) => thread.id));
      const merged = [...retained, ...result.items.filter((thread) => !retainedIds.has(thread.id))];
      setThreads(merged);
      setTotalCount(Math.max(result.totalCount, merged.length));
    } else {
      setThreads(result.items);
      setTotalCount(result.totalCount);
    }
    setPage(result.page);
  }

  async function reloadReviewed(nextPage = page) {
    if (!window.viperReader) return;
    const requestId = ++requestIdRef.current;
    const result = await window.viperReader.listReviewedGenerationQueue(nextPage);
    if (requestId !== requestIdRef.current) return;
    setThreads(result.items);
    setPage(result.page);
    setTotalCount(result.totalCount);
  }

  async function reloadSummary() {
    if (!window.viperReader) return;
    setQueueSummary(await window.viperReader.getReadingQueueSummary());
  }

  async function reloadCurrent(preferredThreadId?: string) {
    if (smartViewRef.current === "generated") await reloadGenerated(0);
    else if (smartViewRef.current === "reviewed") await reloadReviewed(0);
    else if (selectedFeedIdRef.current) await reloadThreads(selectedFeedIdRef.current, preferredThreadId, 0);
  }

  useEffect(() => {
    if (!selectedFeedId) {
      setThreads([]);
      callbacksRef.current.onClearSelection();
      return;
    }
    setPage(0);
    if (smartView === "generated") void reloadGenerated(0);
    else if (smartView === "reviewed") void reloadReviewed(0);
    else void reloadThreads(selectedFeedId, undefined, 0);
  }, [selectedFeedId, showUnreadOnly, smartView]);

  function changePage(nextPage: number) {
    if (!selectedFeedId || nextPage < 0) return;
    if (smartView === "generated") void reloadGenerated(nextPage);
    else if (smartView === "reviewed") void reloadReviewed(nextPage);
    else void reloadThreads(selectedFeedId, undefined, nextPage);
  }

  async function markAllRead() {
    if (!window.viperReader || !selectedFeedId) return;
    if (selectedFeedId === allFeedsId) await window.viperReader.markAllFeedsRead();
    else await window.viperReader.markFeedRead(selectedFeedId);
    setThreads((current) => current.map((thread) => ({ ...thread, isRead: true })));
    if (effectiveShowUnreadOnly) setTotalCount(0);
    await callbacksRef.current.onReloadFeeds();
    await reloadSummary();
  }

  async function toggleRead(threadId: string) {
    if (!window.viperReader) return;
    const item = threads.find((thread) => thread.id === threadId);
    if (!item) return;
    const isRead = !item.isRead;
    await window.viperReader.setThreadRead(item.id, isRead);
    setThreads((current) => current.map((thread) => thread.id === item.id ? { ...thread, isRead } : thread));
    callbacksRef.current.onSelectedThreadReadChange(item.id, isRead);
    await callbacksRef.current.onReloadFeeds();
  }

  return {
    threads,
    setThreads,
    page,
    totalCount,
    showUnreadOnly,
    setShowUnreadOnly,
    smartView,
    smartViewRef,
    setSmartView,
    queueSummary,
    isUnreadOnlyLocked,
    effectiveShowUnreadOnly,
    reloadThreads,
    reloadGenerated,
    reloadReviewed,
    reloadSummary,
    reloadCurrent,
    changePage,
    markAllRead,
    toggleRead
  };
}
