import { useEffect, useRef, useState } from "react";
import type { AppLogEntry, FeedSource, ThreadListItem } from "../../shared/types";
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
  onToggleFavoriteCollapsed: () => void;
  onSelectFavoriteThread: (thread: ThreadListItem) => void;
  allFeedsId: string;
  allUnreadCount: number;
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
  onToggleFavoriteCollapsed,
  onSelectFavoriteThread,
  allFeedsId,
  allUnreadCount
}: FeedPaneProps) {
  const [contextMenu, setContextMenu] = useState<{ feed: FeedSource; x: number; y: number } | null>(null);
  const feedTreeRef = useRef<HTMLDivElement>(null);

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
    <aside className="feed-pane" aria-label="RSS ソース">
      <div className="pane-title">
        <span>板一覧</span>
        <div className="pane-title-actions">
          <button onClick={onAddFeed} title="板を追加" type="button">+</button>
          <button onClick={onDeleteSelectedFeed} disabled={!selectedFeedId || selectedFeedId === allFeedsId} title="選択中の板を削除" type="button">-</button>
        </div>
      </div>
      <div className="feed-tree" ref={feedTreeRef}>
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
            className={`feed-row ${feed.id === selectedFeedId ? "is-selected" : ""}`}
            key={feed.id}
            onClick={() => onSelectFeed(feed.id)}
            onDoubleClick={() => onRefreshFeed(feed.id)}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelectFeed(feed.id);
              setContextMenu({ feed, x: event.clientX, y: event.clientY });
            }}
            title="ダブルクリックでこの板を更新"
            type="button"
          >
            <span className="feed-name">{feed.title}</span>
            <span className="feed-count">{feed.unreadCount}</span>
          </button>
        ))}
      </div>

      <div className="favorite-divider" />

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
