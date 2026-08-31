import { useEffect, useRef, useState } from "react";
import type { FeedFolder, FeedSource, FeedTreePlacement } from "../../shared/types";
import type { FeedTreeSelection } from "../components/FeedPane";

export const allFeedsId = "__all_feeds__";

type UseFeedTreeOptions = {
  onReload: () => Promise<void>;
  onFeedDeleted: (feedId: string) => void;
};

export function useFeedTree({ onReload, onFeedDeleted }: UseFeedTreeOptions) {
  const [feeds, setFeeds] = useState<FeedSource[]>([]);
  const [folders, setFolders] = useState<FeedFolder[]>([]);
  const [selectedTreeNode, setSelectedTreeNode] = useState<FeedTreeSelection>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [selectedFeedId, setSelectedFeedId] = useState("");
  const [allUnreadCount, setAllUnreadCount] = useState(0);
  const selectedFeedIdRef = useRef("");
  const onReloadRef = useRef(onReload);
  const onFeedDeletedRef = useRef(onFeedDeleted);
  selectedFeedIdRef.current = selectedFeedId;
  onReloadRef.current = onReload;
  onFeedDeletedRef.current = onFeedDeleted;

  async function reload() {
    if (!window.viperReader) return;
    const [nextFeeds, nextFolders, nextAllUnreadCount] = await Promise.all([
      window.viperReader.listFeeds(),
      window.viperReader.listFeedFolders(),
      window.viperReader.countUnreadArticles()
    ]);
    setFeeds(nextFeeds);
    setFolders(nextFolders);
    setCollapsedFolderIds((current) => new Set(
      [...current].filter((id) => nextFolders.some((folder) => folder.id === id))
    ));
    setAllUnreadCount(nextAllUnreadCount);
    await onReloadRef.current();
    setSelectedFeedId((current) =>
      current === allFeedsId || nextFeeds.some((feed) => feed.id === current) ? current : allFeedsId
    );
  }

  useEffect(() => {
    void reload();
    if (!window.viperReader) return;
    void window.viperReader.getUserSetting("collapsedFeedFolderIds").then((saved) => {
      if (!saved) return;
      const parsed = JSON.parse(saved) as unknown;
      if (Array.isArray(parsed)) {
        setCollapsedFolderIds(new Set(parsed.filter((id): id is string => typeof id === "string")));
      }
    }).catch((error) => console.error("フォルダ表示設定の読込に失敗しました:", error));
  }, []);

  function selectFeed(feedId: string) {
    setSelectedFeedId(feedId);
    setSelectedTreeNode(feedId === allFeedsId ? null : { type: "feed", id: feedId });
  }

  function selectFolder(folderId: string) {
    setSelectedTreeNode({ type: "folder", id: folderId });
  }

  function toggleFolder(folderId: string) {
    setCollapsedFolderIds((current) => {
      const next = new Set(current);
      next.has(folderId) ? next.delete(folderId) : next.add(folderId);
      void window.viperReader?.saveUserSetting("collapsedFeedFolderIds", JSON.stringify([...next]));
      return next;
    });
  }

  async function saveLayout(placements: FeedTreePlacement[]) {
    if (!window.viperReader) return;
    try {
      await window.viperReader.saveFeedTreeLayout(placements);
      await reload();
    } catch {
      alert("板一覧の並び替えに失敗しました。");
    }
  }

  async function deleteSelected() {
    if (!selectedTreeNode || !window.viperReader) return;
    if (selectedTreeNode.type === "feed") {
      const feed = feeds.find((candidate) => candidate.id === selectedTreeNode.id);
      if (!feed || !confirm(`板「${feed.title}」を削除しますか？\n（この板に含まれるすべての記事やキャッシュも消去されます）`)) return;
      try {
        await window.viperReader.deleteFeedSource(feed.id);
        onFeedDeletedRef.current(feed.id);
        setSelectedTreeNode(null);
        await reload();
      } catch {
        alert("削除に失敗しました。");
      }
      return;
    }

    const folder = folders.find((candidate) => candidate.id === selectedTreeNode.id);
    if (!folder || !confirm(`フォルダ「${folder.name}」を削除しますか？`)) return;
    try {
      await window.viperReader.deleteFeedFolder(folder.id);
      setSelectedTreeNode(null);
      await reload();
    } catch (error) {
      alert(error instanceof Error ? error.message : "フォルダを削除できませんでした。");
    }
  }

  async function saveFolder(mode: "create" | "rename", targetId: string | null, name: string) {
    if (!window.viperReader || !name.trim()) return;
    if (mode === "rename" && targetId) {
      await window.viperReader.renameFeedFolder(targetId, name);
      await reload();
      return;
    }

    const selectedFeed = selectedTreeNode?.type === "feed"
      ? feeds.find((feed) => feed.id === selectedTreeNode.id)
      : null;
    const parentFolderId = selectedTreeNode?.type === "folder"
      ? selectedTreeNode.id
      : selectedFeed?.parentFolderId ?? null;
    const folder = await window.viperReader.createFeedFolder(name, parentFolderId);
    if (selectedFeed) {
      const placements = [
        ...feeds.map((feed) => ({ type: "feed" as const, id: feed.id, parentFolderId: feed.parentFolderId, sortOrder: feed.sortOrder })),
        ...folders.map((item) => ({ type: "folder" as const, id: item.id, parentFolderId: item.parentFolderId, sortOrder: item.sortOrder })),
        { type: "folder" as const, id: folder.id, parentFolderId: folder.parentFolderId, sortOrder: folder.sortOrder }
      ].sort((a, b) => (a.parentFolderId ?? "").localeCompare(b.parentFolderId ?? "") || a.sortOrder - b.sortOrder);
      const createdIndex = placements.findIndex((item) => item.type === "folder" && item.id === folder.id);
      const [created] = placements.splice(createdIndex, 1);
      const selectedIndex = placements.findIndex((item) => item.type === "feed" && item.id === selectedFeed.id);
      placements.splice(selectedIndex + 1, 0, created);
      await window.viperReader.saveFeedTreeLayout(placements.map(({ type, id, parentFolderId: parent }) => ({
        type,
        id,
        parentFolderId: parent
      })));
    }
    if (parentFolderId && collapsedFolderIds.has(parentFolderId)) toggleFolder(parentFolderId);
    setSelectedTreeNode({ type: "folder", id: folder.id });
    await reload();
  }

  const selectedFeed = selectedFeedId === allFeedsId
    ? {
        id: allFeedsId,
        title: "全体共通",
        url: "登録済みの全板・記事時刻の新しい順",
        unreadCount: feeds.reduce((sum, feed) => sum + feed.unreadCount, 0),
        lastFetchedAt: null,
        generateTitleFromSummary: false,
        skipTitleConversion: false,
        defaultToArticleBrowser: false,
        parentFolderId: null,
        sortOrder: -1
      }
    : feeds.find((feed) => feed.id === selectedFeedId) ?? feeds[0];

  return {
    feeds,
    setFeeds,
    folders,
    selectedTreeNode,
    setSelectedTreeNode,
    collapsedFolderIds,
    selectedFeedId,
    selectedFeedIdRef,
    setSelectedFeedId,
    selectedFeed,
    allUnreadCount,
    reload,
    selectFeed,
    selectFolder,
    toggleFolder,
    saveLayout,
    deleteSelected,
    saveFolder
  };
}
