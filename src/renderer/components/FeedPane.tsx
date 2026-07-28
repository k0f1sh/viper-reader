import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
import type { AppLogEntry, FeedSource, ReadingQueueSummary, SmartView, ThreadListItem } from "../../shared/types";
import { LogPane } from "./LogPane";

type FeedPaneProps = {
  feeds: FeedSource[];
  favoriteThreads: ThreadListItem[];
  logs: AppLogEntry[];
  selectedFeedId: string;
  selectedThreadId: string | undefined;
  isFavoriteCollapsed: boolean;
  onSelectFeed: (feedId: string) => void;
  onRefreshFeed: (feedId: string) => void;
  onAddFeed: () => void;
  onDeleteSelectedFeed: () => void;
  onOpenFeedSettings: (feed: FeedSource) => void;
  onReorderFeeds: (feedIds: string[]) => void;
  onToggleFavoriteCollapsed: () => void;
  onSelectFavoriteThread: (thread: ThreadListItem) => void;
  allFeedsId: string;
  allUnreadCount: number;
  queueSummary: ReadingQueueSummary;
  activeSmartView: SmartView | null;
  onSelectSmartView: (view: SmartView) => void;
  feedTreeHeight: number;
  onStartFeedTreeResize: (event: ReactMouseEvent<HTMLDivElement>) => void;
};

export function FeedPane({
  feeds,
  favoriteThreads,
  logs,
  selectedFeedId,
  selectedThreadId,
  isFavoriteCollapsed,
  onSelectFeed,
  onRefreshFeed,
  onAddFeed,
  onDeleteSelectedFeed,
  onOpenFeedSettings,
  onReorderFeeds,
  onToggleFavoriteCollapsed,
  onSelectFavoriteThread,
  allFeedsId,
  allUnreadCount,
  queueSummary,
  activeSmartView,
  onSelectSmartView,
  feedTreeHeight,
  onStartFeedTreeResize
}: FeedPaneProps) {
  const [contextMenu, setContextMenu] = useState<{ feed: FeedSource; x: number; y: number } | null>(null);
  const [draggedFeedId, setDraggedFeedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ feedId: string; position: "before" | "after" } | null>(null);
  const feedTreeRef = useRef<HTMLDivElement>(null);

  function updateDropTarget(event: ReactDragEvent<HTMLButtonElement>, feedId: string) {
    if (!draggedFeedId || draggedFeedId === feedId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropTarget({
      feedId,
      position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after"
    });
  }

  function dropFeed(event: ReactDragEvent<HTMLButtonElement>) {
    event.preventDefault();
    if (!draggedFeedId || !dropTarget || draggedFeedId === dropTarget.feedId) return;
    const nextFeeds = feeds.filter((feed) => feed.id !== draggedFeedId);
    const targetIndex = nextFeeds.findIndex((feed) => feed.id === dropTarget.feedId);
    const insertIndex = targetIndex + (dropTarget.position === "after" ? 1 : 0);
    nextFeeds.splice(insertIndex, 0, feeds.find((feed) => feed.id === draggedFeedId)!);
    onReorderFeeds(nextFeeds.map((feed) => feed.id));
    setDraggedFeedId(null);
    setDropTarget(null);
  }

  useEffect(() => {
    const selectedRow = feedTreeRef.current?.querySelector<HTMLElement>(".feed-row.is-selected");
    selectedRow?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedFeedId, feeds]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
    };
  }, [contextMenu]);

  return (
    <aside
      className="feed-pane"
      aria-label="RSS ソース"
      style={{ "--feed-tree-height": `${feedTreeHeight}px` } as CSSProperties}
    >
      <div className="pane-title">
        <span>板一覧</span>
        <div className="pane-title-actions">
          <button onClick={onAddFeed} title="板を追加" type="button">+</button>
          <button onClick={onDeleteSelectedFeed} disabled={!selectedFeedId || selectedFeedId === allFeedsId} title="選択中の板を削除" type="button">-</button>
        </div>
      </div>
      <div className="feed-tree" ref={feedTreeRef}>
        <div className="tree-heading">キュー</div>
        <button
          className={`feed-row smart-feed-row ${activeSmartView === "unread" ? "is-selected" : ""}`}
          onClick={() => onSelectSmartView("unread")}
          type="button"
        >
          <span className="feed-name">未読</span>
          <span className="feed-count">{queueSummary.unreadCount}</span>
        </button>
        <button
          className={`feed-row smart-feed-row ${activeSmartView === "generated" ? "is-selected" : ""}`}
          onClick={() => onSelectSmartView("generated")}
          type="button"
        >
          <span className="feed-name">生成済み・未確認</span>
          <span className="feed-count">{queueSummary.completedCount}</span>
        </button>
        <button
          className={`feed-row smart-feed-row ${activeSmartView === "reviewed" ? "is-selected" : ""}`}
          onClick={() => onSelectSmartView("reviewed")}
          type="button"
        >
          <span className="feed-name">生成済み・確認済み</span>
        </button>
        <div className="tree-heading">RSS</div>
        <button
          className={`feed-row ${selectedFeedId === allFeedsId ? "is-selected" : ""}`}
          onClick={() => onSelectFeed(allFeedsId)}
          title="全板の記事を新着順で表示"
          type="button"
        >
          <span className="feed-name">全板共通</span>
          <span className="feed-count">{allUnreadCount}</span>
        </button>
        {feeds.map((feed) => (
          <button
            className={[
              "feed-row",
              feed.id === selectedFeedId ? "is-selected" : "",
              feed.id === draggedFeedId ? "is-dragging" : "",
              dropTarget?.feedId === feed.id ? `is-drop-${dropTarget.position}` : ""
            ].filter(Boolean).join(" ")}
            draggable
            key={feed.id}
            onDragStart={(event) => {
              setDraggedFeedId(feed.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", feed.id);
            }}
            onDragOver={(event) => updateDropTarget(event, feed.id)}
            onDrop={dropFeed}
            onDragEnd={() => {
              setDraggedFeedId(null);
              setDropTarget(null);
            }}
            onClick={() => onSelectFeed(feed.id)}
            onDoubleClick={() => onRefreshFeed(feed.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelectFeed(feed.id);
              setContextMenu({ feed, x: event.clientX, y: event.clientY });
            }}
            title="ドラッグで並べ替え・ダブルクリックでこの板を更新"
            type="button"
          >
            <span className="feed-name">{feed.title}</span>
            <span className="feed-count">{feed.unreadCount}</span>
          </button>
        ))}
      </div>

      <div
        aria-label="板一覧とお気に入りの境界"
        aria-orientation="horizontal"
        className="favorite-divider"
        onMouseDown={onStartFeedTreeResize}
        role="separator"
      />

      <div className="favorite-pane">
        <div className="pane-title favorite-title" onClick={onToggleFavoriteCollapsed} style={{ cursor: "pointer", userSelect: "none" }}>
          <span>{isFavoriteCollapsed ? "▶" : "▼"} お気に入り ({favoriteThreads.length})</span>
        </div>
        {!isFavoriteCollapsed ? (
          <div className="favorite-tree">
            {favoriteThreads.length === 0 ? (
              <div className="favorite-empty">お気に入りはありません</div>
            ) : (
              favoriteThreads.map((thread) => {
                const isSelected = thread.id === selectedThreadId;
                return (
                  <button
                    className={`favorite-row ${isSelected ? "is-selected" : ""}`}
                    key={thread.id}
                    onClick={() => onSelectFavoriteThread(thread)}
                    title={thread.vipTitle}
                    type="button"
                  >
                    <span className="favorite-item-star">★</span>
                    <span className="favorite-item-title">{thread.vipTitle}</span>
                    <span className="favorite-item-count">{thread.responseCount}</span>
                  </button>
                );
              })
            )}
          </div>
        ) : null}
      </div>

      <div className="log-divider" />
      <LogPane logs={logs} />
      {contextMenu ? (
        <div
          className="feed-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            onClick={() => {
              onOpenFeedSettings(contextMenu.feed);
              setContextMenu(null);
            }}
            role="menuitem"
            type="button"
          >
            板の設定...
          </button>
        </div>
      ) : null}
    </aside>
  );
}
