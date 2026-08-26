import { useEffect, useRef } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { FeedSource, ReadingQueueSummary, SmartView, ThreadListItem } from "../../shared/types";
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
  isUnreadOnlyLocked: boolean;
  threadColumnLabels: readonly string[];
  threadGridColumns: string;
  threadListMinWidth: number;
  onRefresh: () => void;
  onSelectThread: (threadId: string) => void;
  onShowGenerationFailure: (threadId: string) => void;
  onShowTitleGenerationStatus: (threadId: string) => void;
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
  smartView: SmartView | null;
  queueSummary: ReadingQueueSummary;
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
  isUnreadOnlyLocked,
  threadColumnLabels,
  threadGridColumns,
  threadListMinWidth,
  onRefresh,
  onSelectThread,
  onShowGenerationFailure,
  onShowTitleGenerationStatus,
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
  queueSummary
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
        <div className="thread-toolbar-right">
          <div className="queue-status" role="status">
            <span>未読 {queueSummary.unreadCount}</span>
            <span>待ち {queueSummary.queuedCount}</span>
            <span>生成中 {queueSummary.generatingCount}</span>
            <span className={queueSummary.completedCount > 0 ? "has-completed" : ""}>生成済 {queueSummary.completedCount}</span>
          </div>
          <div className="thread-toolbar-actions">
            <button
              className={`refresh-button ${showUnreadOnly ? "is-active" : ""}`}
              disabled={isUnreadOnlyLocked}
              onClick={onToggleUnreadOnly}
              type="button"
            >
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
          const isGenerated = thread.generationStatus === "completed" || thread.responseCount > 1;
          const lampStatus = isFailed
            ? "response-failed"
            : thread.titleGenerationStatus === "failed"
              ? "title-failed"
            : isGenerating
              ? "generating"
              : isQueued
                ? "queued"
                : thread.titleGenerationStatus === "skipped"
                  ? "title-skipped"
                : isGenerated
                  ? "generated"
                  : "empty";
          const lampLabel = {
            empty: "未生成",
            queued: "生成待ち",
            generating: "生成中",
            generated: "生成済み",
            "response-failed": "レス生成失敗",
            "title-failed": "スレタイ変換失敗",
            "title-skipped": "スレタイ未変換"
          }[lampStatus];
          const isLampClickable =
            lampStatus === "response-failed"
            || lampStatus === "title-failed"
            || lampStatus === "title-skipped";
          function showLampDetails() {
            if (lampStatus === "response-failed") {
              onShowGenerationFailure(thread.id);
            } else if (lampStatus === "title-failed" || lampStatus === "title-skipped") {
              onShowTitleGenerationStatus(thread.id);
            }
          }
          return (
            <button
              className={`thread-row ${thread.id === selectedThreadId ? "is-selected" : ""} ${
                thread.isRead ? "is-read" : ""
              } ${isGenerating ? "is-generating" : ""} ${isCompleted ? "is-generation-completed" : ""}`}
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              type="button"
            >
              <span
                aria-label={lampLabel}
                className="thread-generation-cell"
              >
                <span
                  className={isLampClickable ? "thread-status-marker is-clickable" : "thread-status-marker"}
                  onClick={(event) => {
                    if (!isLampClickable) return;
                    event.stopPropagation();
                    showLampDetails();
                  }}
                  onKeyDown={(event) => {
                    if (!isLampClickable || (event.key !== "Enter" && event.key !== " ")) return;
                    event.preventDefault();
                    event.stopPropagation();
                    showLampDetails();
                  }}
                  role={isLampClickable ? "button" : undefined}
                  tabIndex={isLampClickable ? 0 : undefined}
                  title={lampLabel}
                >
                  <span aria-hidden="true" className={`thread-status-lamp is-${lampStatus}`} />
                </span>
              </span>
              <span className="thread-title">
                {thread.threadTitle}
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
      <div className="thread-list-pagination">
        <div className="thread-status-legend" aria-label="状態の凡例">
          <LegendLamp status="response-failed" label="レス失敗" />
          <LegendLamp status="title-failed" label="タイトル失敗" />
          <LegendLamp status="generating" label="生成中" />
          <LegendLamp status="queued" label="待機" />
          <LegendLamp status="title-skipped" label="未変換" />
          <LegendLamp status="generated" label="生成済" />
        </div>
        <div className="thread-pagination-controls">
          <button disabled={page === 0} onClick={onPreviousPage} type="button">◀ 前の100件</button>
          <span>{totalCount === 0 ? "0件" : `${page * pageSize + 1}〜${Math.min((page + 1) * pageSize, totalCount)} / ${totalCount}件`}</span>
          <button disabled={(page + 1) * pageSize >= totalCount} onClick={onNextPage} type="button">次の100件 ▶</button>
        </div>
      </div>
    </section>
  );
}

function LegendLamp({ status, label }: { status: string; label: string }) {
  return (
    <span className="thread-status-legend-item">
      <span aria-hidden="true" className={`thread-status-lamp is-${status}`} />
      <span>{label}</span>
    </span>
  );
}
