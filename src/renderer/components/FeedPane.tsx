import { useEffect, useRef, useState } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { AppLogEntry, FeedFolder, FeedSource, FeedTreePlacement, ReadingQueueSummary, SmartView, ThreadListItem } from "../../shared/types";
import { LogPane } from "./LogPane";

export type FeedTreeSelection = { type: "feed" | "folder"; id: string } | null;
type TreeNode = { type: "feed"; item: FeedSource } | { type: "folder"; item: FeedFolder };
type DropTarget = { type: "feed" | "folder"; id: string; position: "before" | "inside" | "after" } | { type: "root" };

type FeedPaneProps = {
  feeds: FeedSource[];
  folders: FeedFolder[];
  collapsedFolderIds: Set<string>;
  selectedTreeNode: FeedTreeSelection;
  favoriteThreads: ThreadListItem[];
  logs: AppLogEntry[];
  selectedFeedId: string;
  selectedThreadId: string | undefined;
  isFavoriteCollapsed: boolean;
  onSelectFeed: (feedId: string) => void;
  onSelectFolder: (folderId: string) => void;
  onToggleFolder: (folderId: string) => void;
  onRefreshFeed: (feedId: string) => void;
  onAddFeed: () => void;
  onAddFolder: () => void;
  onDeleteSelectedNode: () => void;
  onOpenFeedSettings: (feed: FeedSource) => void;
  onRenameFolder: (folder: FeedFolder) => void;
  onSaveTreeLayout: (placements: FeedTreePlacement[]) => void;
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

export function FeedPane(props: FeedPaneProps) {
  const { feeds, folders, collapsedFolderIds, selectedTreeNode } = props;
  const [contextMenu, setContextMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);
  const [draggedNode, setDraggedNode] = useState<{ type: "feed" | "folder"; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const feedTreeRef = useRef<HTMLDivElement>(null);

  const nodes: TreeNode[] = [
    ...feeds.map((item): TreeNode => ({ type: "feed", item })),
    ...folders.map((item): TreeNode => ({ type: "folder", item }))
  ];
  const nodeByKey = new Map(nodes.map((node) => [`${node.type}:${node.item.id}`, node]));
  const childrenByParent = new Map<string | null, TreeNode[]>();
  for (const node of nodes) {
    const parentId = node.item.parentFolderId;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(node);
    childrenByParent.set(parentId, children);
  }
  for (const children of childrenByParent.values()) children.sort((a, b) => a.item.sortOrder - b.item.sortOrder);

  function updateDropTarget(event: ReactDragEvent<HTMLButtonElement>, node: TreeNode) {
    if (!draggedNode || (draggedNode.type === node.type && draggedNode.id === node.item.id)) return;
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / bounds.height;
    const position = node.type === "folder" && ratio >= 0.25 && ratio <= 0.75
      ? "inside"
      : ratio < 0.5 ? "before" : "after";
    const destinationParentId = position === "inside" && node.type === "folder" ? node.item.id : node.item.parentFolderId;
    if (draggedNode.type === "folder" && destinationParentId && isFolderDescendant(destinationParentId, draggedNode.id, folders)) return;
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ type: node.type, id: node.item.id, position });
  }

  function completeDrop(event: ReactDragEvent) {
    event.preventDefault();
    if (!draggedNode || !dropTarget) return;
    const placements = moveTreeNode(nodes, draggedNode, dropTarget);
    if (placements) {
      if (dropTarget.type === "folder" && dropTarget.position === "inside" && collapsedFolderIds.has(dropTarget.id)) {
        props.onToggleFolder(dropTarget.id);
      }
      props.onSaveTreeLayout(placements);
    }
    setDraggedNode(null);
    setDropTarget(null);
  }

  function openContextSettings(node: TreeNode) {
    if (node.type === "feed") props.onOpenFeedSettings(node.item);
    else props.onRenameFolder(node.item);
    setContextMenu(null);
  }

  function renderNodes(parentId: string | null, depth: number): ReactNode {
    return (childrenByParent.get(parentId) ?? []).map((node) => {
      const key = `${node.type}:${node.item.id}`;
      const isFolder = node.type === "folder";
      const isCollapsed = isFolder && collapsedFolderIds.has(node.item.id);
      const unreadCount = isFolder ? countFolderUnread(node.item.id, feeds, folders) : node.item.unreadCount;
      const target = dropTarget && dropTarget.type !== "root" && dropTarget.type === node.type && dropTarget.id === node.item.id ? dropTarget : null;
      return (
        <div key={key}>
          <button
            className={[
              "feed-row", isFolder ? "folder-row" : "",
              selectedTreeNode?.type === node.type && selectedTreeNode.id === node.item.id ? "is-selected" : "",
              draggedNode?.type === node.type && draggedNode.id === node.item.id ? "is-dragging" : "",
              target ? `is-drop-${target.position}` : ""
            ].filter(Boolean).join(" ")}
            draggable
            onDragStart={(event) => {
              setDraggedNode({ type: node.type, id: node.item.id });
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", key);
            }}
            onDragOver={(event) => updateDropTarget(event, node)}
            onDrop={completeDrop}
            onDragEnd={() => { setDraggedNode(null); setDropTarget(null); }}
            onClick={() => isFolder ? (props.onSelectFolder(node.item.id), props.onToggleFolder(node.item.id)) : props.onSelectFeed(node.item.id)}
            onDoubleClick={() => { if (!isFolder) props.onRefreshFeed(node.item.id); }}
            onContextMenu={(event) => {
              event.preventDefault();
              isFolder ? props.onSelectFolder(node.item.id) : props.onSelectFeed(node.item.id);
              setContextMenu({ node, x: event.clientX, y: event.clientY });
            }}
            style={{ paddingLeft: `${13 + depth * 15}px` }}
            aria-expanded={isFolder ? !isCollapsed : undefined}
            title={isFolder ? "クリックで開閉・ドラッグで移動" : "ドラッグで移動・ダブルクリックでこの板を更新"}
            type="button"
          >
            <span className="feed-name"><span className="folder-disclosure">{isFolder ? (isCollapsed ? "▶" : "▼") : ""}</span>{isFolder ? node.item.name : node.item.title}</span>
            <span className="feed-count">{unreadCount}</span>
          </button>
          {isFolder && !isCollapsed ? renderNodes(node.item.id, depth + 1) : null}
        </div>
      );
    });
  }

  useEffect(() => {
    feedTreeRef.current?.querySelector<HTMLElement>(".feed-row.is-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [props.activeSmartView, props.selectedFeedId, selectedTreeNode, feeds, folders]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); };
  }, [contextMenu]);

  return (
    <aside className="feed-pane" aria-label="RSS ソース" style={{ "--feed-tree-height": `${props.feedTreeHeight}px` } as CSSProperties}>
      <div className="pane-title"><span>板一覧</span><div className="pane-title-actions">
        <button onClick={props.onAddFeed} title="板を追加" type="button">+</button>
        <button onClick={props.onAddFolder} title="フォルダを追加" type="button">F+</button>
        <button onClick={props.onDeleteSelectedNode} disabled={!selectedTreeNode} title="選択中の板またはフォルダを削除" type="button">-</button>
      </div></div>
      <div className="feed-tree" ref={feedTreeRef}>
        <div className="tree-heading">キュー</div>
        <SmartRow label="未読" count={props.queueSummary.unreadCount} selected={props.activeSmartView === "unread"} onClick={() => props.onSelectSmartView("unread")} />
        <SmartRow label="生成済み・未確認" count={props.queueSummary.completedCount} selected={props.activeSmartView === "generated"} onClick={() => props.onSelectSmartView("generated")} />
        <SmartRow label="生成済み・確認済み" selected={props.activeSmartView === "reviewed"} onClick={() => props.onSelectSmartView("reviewed")} />
        <div
          className={`tree-heading rss-tree-root ${dropTarget?.type === "root" ? "is-drop-inside" : ""}`}
          onDragOver={(event) => { if (draggedNode) { event.preventDefault(); setDropTarget({ type: "root" }); } }}
          onDrop={completeDrop}
        >RSS</div>
        <button className={`feed-row ${props.selectedFeedId === props.allFeedsId && !selectedTreeNode ? "is-selected" : ""}`} onClick={() => props.onSelectFeed(props.allFeedsId)} title="全板の記事を新着順で表示" type="button">
          <span className="feed-name">全体共通</span><span className="feed-count">{props.allUnreadCount}</span>
        </button>
        {renderNodes(null, 0)}
      </div>
      <div aria-label="板一覧とお気に入りの境界" aria-orientation="horizontal" className="favorite-divider" onMouseDown={props.onStartFeedTreeResize} role="separator" />
      <div className="favorite-pane"><div className="pane-title favorite-title" onClick={props.onToggleFavoriteCollapsed} style={{ cursor: "pointer", userSelect: "none" }}><span>{props.isFavoriteCollapsed ? "▶" : "▼"} お気に入り ({props.favoriteThreads.length})</span></div>
        {!props.isFavoriteCollapsed ? <div className="favorite-tree">{props.favoriteThreads.length === 0 ? <div className="favorite-empty">お気に入りはありません</div> : props.favoriteThreads.map((thread) => <button className={`favorite-row ${thread.id === props.selectedThreadId ? "is-selected" : ""}`} key={thread.id} onClick={() => props.onSelectFavoriteThread(thread)} title={thread.threadTitle} type="button"><span className="favorite-item-star">★</span><span className="favorite-item-title">{thread.threadTitle}</span><span className="favorite-item-count">{thread.responseCount}</span></button>)}</div> : null}
      </div>
      <div className="log-divider" /><LogPane logs={props.logs} />
      {contextMenu ? <div className="feed-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onClick={(event) => event.stopPropagation()}>
        {contextMenu.node.type === "feed" ? <button onClick={() => openContextSettings(contextMenu.node)} role="menuitem" type="button">板の設定...</button> : <>
          <button onClick={() => openContextSettings(contextMenu.node)} role="menuitem" type="button">名前変更...</button>
          <button onClick={() => { props.onDeleteSelectedNode(); setContextMenu(null); }} role="menuitem" type="button">削除</button>
        </>}
      </div> : null}
    </aside>
  );
}

function SmartRow({ label, count, selected, onClick }: { label: string; count?: number; selected: boolean; onClick: () => void }) {
  return <button className={`feed-row smart-feed-row ${selected ? "is-selected" : ""}`} onClick={onClick} type="button"><span className="feed-name">{label}</span>{count !== undefined ? <span className="feed-count">{count}</span> : null}</button>;
}

function countFolderUnread(folderId: string, feeds: FeedSource[], folders: FeedFolder[]): number {
  const childIds = new Set([folderId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const folder of folders) if (folder.parentFolderId && childIds.has(folder.parentFolderId) && !childIds.has(folder.id)) { childIds.add(folder.id); changed = true; }
  }
  return feeds.reduce((sum, feed) => sum + (feed.parentFolderId && childIds.has(feed.parentFolderId) ? feed.unreadCount : 0), 0);
}

function isFolderDescendant(candidateId: string, ancestorId: string, folders: FeedFolder[]): boolean {
  let current: string | null | undefined = candidateId;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  while (current) {
    if (current === ancestorId) return true;
    current = byId.get(current)?.parentFolderId;
  }
  return false;
}

function moveTreeNode(nodes: TreeNode[], dragged: { type: "feed" | "folder"; id: string }, target: DropTarget): FeedTreePlacement[] | null {
  const draggedNode = nodes.find((node) => node.type === dragged.type && node.item.id === dragged.id);
  if (!draggedNode) return null;
  const siblings = new Map<string | null, TreeNode[]>();
  for (const node of nodes) {
    const parent = node.item.parentFolderId;
    const list = siblings.get(parent) ?? [];
    if (!(node.type === dragged.type && node.item.id === dragged.id)) list.push(node);
    siblings.set(parent, list);
  }
  for (const list of siblings.values()) list.sort((a, b) => a.item.sortOrder - b.item.sortOrder);
  let parentId: string | null;
  let index: number;
  if (target.type === "root") {
    parentId = null; index = (siblings.get(null) ?? []).length;
  } else if (target.position === "inside" && target.type === "folder") {
    parentId = target.id; index = (siblings.get(parentId) ?? []).length;
  } else {
    const targetNode = nodes.find((node) => node.type === target.type && node.item.id === target.id);
    if (!targetNode) return null;
    parentId = targetNode.item.parentFolderId;
    const list = siblings.get(parentId) ?? [];
    const targetIndex = list.findIndex((node) => node.type === target.type && node.item.id === target.id);
    index = targetIndex + (target.position === "after" ? 1 : 0);
  }
  const destination = siblings.get(parentId) ?? [];
  destination.splice(index, 0, draggedNode);
  siblings.set(parentId, destination);
  const placements: FeedTreePlacement[] = [];
  const visit = (parent: string | null) => {
    for (const node of siblings.get(parent) ?? []) {
      placements.push({ type: node.type, id: node.item.id, parentFolderId: parent });
      if (node.type === "folder") visit(node.item.id);
    }
  };
  visit(null);
  return placements.length === nodes.length ? placements : null;
}
