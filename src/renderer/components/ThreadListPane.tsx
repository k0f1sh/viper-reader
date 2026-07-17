import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { FeedSource, ThreadDetail, ThreadListItem } from "../../shared/types";
import { formatThreadDate } from "./formatters";

type ThreadListPaneProps = {
  selectedFeed: FeedSource | undefined;
  selectedThread: ThreadDetail | null;
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
};

export function ThreadListPane({
  selectedFeed,
  selectedThread,
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
  onStartColumnResize
}: ThreadListPaneProps) {
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
          <div className="pane-title">スレタイ一覧</div>
          <div className="pane-subtitle">{selectedFeed?.url ?? ""}</div>
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
          disabled={isRefreshing || !selectedFeed}
          onClick={onRefresh}
          type="button"
        >
          {isRefreshing ? "取得中" : "更新"}
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
      <div className="thread-list">
        {threads.map((thread) => {
          const isGenerating = generatingThreadIds.has(thread.id);
          const isCompleted = completedThreadIds.has(thread.id);
          return (
            <button
              className={`thread-row ${thread.id === selectedThread?.id ? "is-selected" : ""} ${
                thread.isRead ? "is-read" : ""
              } ${isGenerating ? "is-generating" : ""} ${isCompleted ? "is-generation-completed" : ""}`}
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              type="button"
            >
              <span className="thread-title">
                {isGenerating ? <span className="status-badge generating">[生成中] </span> : null}
                {isCompleted ? <span className="status-badge completed">[完了] </span> : null}
                {thread.vipTitle}
              </span>
              <span className="thread-original-title">{thread.originalTitle}</span>
              <span className="thread-count">{thread.responseCount}</span>
              <span className="thread-source">{thread.source}</span>
              <span className="thread-date">{formatThreadDate(thread.publishedAt)}</span>
              <span className="thread-url">{thread.url}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
