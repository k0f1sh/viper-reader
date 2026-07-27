import { useEffect, useRef } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { FeedSource, ReadingQueueSummary, ThreadListItem } from "../../shared/types";
import { formatThreadDate } from "./formatters";

type ThreadListPaneProps = {
  selectedFeed: FeedSource | undefined;
  selectedThreadId: string | undefined;
  threads: ThreadListItem[];
  generatingThreadIds: Set<string>;
  completedThreadIds: Set<string>;
  isRefreshing: boolean;
  refreshMessage: string;
  showUnreadOnly: boolean;
  threadColumnLabels: readonly string[];
  threadGridColumns: string;
  threadListMinWidth: number;
  onRefresh: () => void;
  onSelectThread: (threadId: string) => void;
  onToggleUnreadOnly: () => void;
  onMarkAllRead: () => void;
  onStartColumnResize: (columnIndex: number, event: ReactMouseEvent<HTMLSpanElement>) => void;
  canRefresh: boolean;
  refreshLabel: string;
  page: number;
  pageSize: number;
  totalCount: number;
  onPreviousPage: () => void;
  onNextPage: () => void;
  smartView: "unread" | "generated" | "reviewed" | null;
  queueSummary: ReadingQueueSummary;
  onOpenGeneratedQueue: () => void;
};

export function ThreadListPane({
  selectedFeed,
  selectedThreadId,
  threads,
  generatingThreadIds,
  completedThreadIds,
  isRefreshing,
  refreshMessage,
  showUnreadOnly,
  threadColumnLabels,
  threadGridColumns,
  threadListMinWidth,
  onRefresh,
  onSelectThread,
  onToggleUnreadOnly,
  onMarkAllRead,
  onStartColumnResize,
  canRefresh,
  refreshLabel,
  page,
  pageSize,
  totalCount,
  onPreviousPage,
  onNextPage,
  smartView,
  queueSummary,
  onOpenGeneratedQueue
}: ThreadListPaneProps) {
  const threadListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const selectedRow = threadListRef.current?.querySelector<HTMLElement>(".thread-row.is-selected");
    selectedRow?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedThreadId, threads]);

  return (
    <section
      className="thread-list-pane"
      aria-label="スレタイ一覧"
      style={
        {
          "--thread-grid-columns": threadGridColumns,
          "--thread-list-min-width": `${threadListMinWidth}px`
        } as CSSProperties
      }
    >
      <div className="toolbar">
        <div>
          <div className="pane-title">
            {smartView === "unread"
              ? "未読チェック"
              : smartView === "generated"
                ? "生成済み・未確認"
                : smartView === "reviewed"
                  ? "生成済み・確認済み"
                  : "スレタイ一覧"}
          </div>
          <div className="pane-subtitle">{selectedFeed?.url ?? ""}</div>
        </div>
        <div className="queue-status" role="status">
          <span>未読 {queueSummary.unreadCount}</span>
          <span>待ち {queueSummary.queuedCount}</span>
          <span>生成中 {queueSummary.generatingCount}</span>
          <span className={queueSummary.completedCount > 0 ? "has-completed" : ""}>完成 {queueSummary.completedCount}</span>
        </div>
        <div className="thread-toolbar-actions">
        <button className={`refresh-button ${showUnreadOnly ? "is-active" : ""}`} onClick={onToggleUnreadOnly} type="button">
          {showUnreadOnly ? "未読のみ ✓" : "未読のみ"}
        </button>
        <button className="refresh-button" disabled={!threads.some((thread) => !thread.isRead)} onClick={onMarkAllRead} type="button">
          すべて既読
        </button>
        <button
          className="refresh-button"
          disabled={isRefreshing || !selectedFeed || !canRefresh}
          onClick={onRefresh}
          type="button"
        >
          {isRefreshing ? "取得中" : refreshLabel}
        </button>
        </div>
      </div>
      {refreshMessage ? (
        <div className={`refresh-status ${isRefreshing ? "is-loading" : ""}`}>
          <span>{refreshMessage}</span>
          {isRefreshing ? <span className="progress-blocks" aria-hidden="true" /> : null}
        </div>
      ) : null}

      <div className="thread-list-header">
        {threadColumnLabels.map((label, index) => (
          <span className="thread-header-cell" key={label}>
            <span className="thread-header-label">{label}</span>
            {index < threadColumnLabels.length - 1 ? (
              <span
                aria-label={`${label}列の幅を変更`}
                className="column-resize-handle"
                onMouseDown={(event) => onStartColumnResize(index, event)}
                role="separator"
              />
            ) : null}
          </span>
        ))}
      </div>
      <div className="thread-list" ref={threadListRef}>
        {threads.map((thread) => {
          const isGenerating = generatingThreadIds.has(thread.id);
          const isCompleted = completedThreadIds.has(thread.id);
          const isQueued = thread.generationStatus === "queued";
          const isFailed = thread.generationStatus === "failed";
          return (
            <button
              className={`thread-row ${thread.id === selectedThreadId ? "is-selected" : ""} ${
                thread.isRead ? "is-read" : ""
              } ${isGenerating ? "is-generating" : ""} ${isCompleted ? "is-generation-completed" : ""}`}
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              type="button"
            >
              <span className="thread-title">
                {isGenerating ? <span className="status-badge generating">[生成中] </span> : null}
                {!isGenerating && isQueued ? <span className="status-badge generating">[待機中] </span> : null}
                {isCompleted ? <span className="status-badge completed">[完了] </span> : null}
                {isFailed ? <span className="status-badge failed">[失敗] </span> : null}
                {thread.vipTitle}
              </span>
              <span className="thread-source">{thread.source}</span>
              <span className="thread-original-title">{thread.originalTitle}</span>
              <span className="thread-count">{thread.responseCount}</span>
              <span className="thread-date">{formatThreadDate(thread.publishedAt)}</span>
              <span className="thread-url">{thread.url}</span>
            </button>
          );
        })}
      </div>
      {smartView === "unread"
        && threads.length > 0
        && totalCount <= threads.length
        && threads.every((thread) => thread.isRead) ? (
        <div className="queue-complete-banner">
          <span>未読チェック完了</span>
          {queueSummary.completedCount > 0 ? (
            <button onClick={onOpenGeneratedQueue} type="button">
              生成済みを読む（{queueSummary.completedCount}件）
            </button>
          ) : queueSummary.generatingCount > 0 || queueSummary.queuedCount > 0 ? (
            <span>生成完了を待っています</span>
          ) : null}
        </div>
      ) : null}
      <div className="thread-list-pagination">
        <button disabled={page === 0} onClick={onPreviousPage} type="button">◀ 前の100件</button>
        <span>{totalCount === 0 ? "0件" : `${page * pageSize + 1}〜${Math.min((page + 1) * pageSize, totalCount)} / ${totalCount}件`}</span>
        <button disabled={(page + 1) * pageSize >= totalCount} onClick={onNextPage} type="button">次の100件 ▶</button>
      </div>
    </section>
  );
}
