import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { AppLogEntry, ArticleBodyContent, FeedSource, GeminiApiKeyStatus, ReplyRating, ResidentPromptVersion, StatisticsSummary, ThreadDetail, ThreadListItem, ThreadPost } from "../shared/types";
import { AddFeedModal } from "./components/AddFeedModal";
import { ArticleBodyPane } from "./components/ArticleBodyPane";
import { FeedPane } from "./components/FeedPane";
import { MenuBar } from "./components/MenuBar";
import { ReplyPopup } from "./components/ReplyPopup";
import { ResidentPromptsModal } from "./components/ResidentPromptsModal";
import { SettingsModal } from "./components/SettingsModal";
import { StatisticsModal } from "./components/StatisticsModal";
import { ThreadListPane } from "./components/ThreadListPane";
import { ThreadReaderPane } from "./components/ThreadReaderPane";
import { ThreadTabs } from "./components/ThreadTabs";
import type { OpenThreadTab } from "./components/ThreadTabs";

const threadColumnLabels = ["スレタイ", "元タイトル", "レス", "取得元", "日時 ▼", "URL"] as const;
const defaultThreadColumnWidths = [360, 300, 54, 170, 126, 260];
const minThreadColumnWidths = [220, 180, 44, 100, 96, 140];
const maxRendererLogs = 300;
const allFeedsId = "__all_feeds__";

function scrollReadMarkerToTop() {
  setTimeout(() => {
    const postsContainer = document.querySelector<HTMLElement>(".posts");
    const readMarker = document.querySelector<HTMLElement>('[data-read-marker="true"]');
    if (!postsContainer || !readMarker) {
      return;
    }

    const containerRect = postsContainer.getBoundingClientRect();
    const markerRect = readMarker.getBoundingClientRect();
    postsContainer.scrollTop += markerRect.top - containerRect.top;
  }, 100);
}

export function App() {
  const [feedList, setFeedList] = useState<FeedSource[]>([]);
  const [threadList, setThreadList] = useState<ThreadListItem[]>([]);
  const [threadListPage, setThreadListPage] = useState(0);
  const [threadListTotalCount, setThreadListTotalCount] = useState(0);
  const [selectedFeedId, setSelectedFeedId] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const selectedThreadIdRef = useRef<string | undefined>(undefined);
  selectedThreadIdRef.current = selectedThreadId;
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
  const [openThreadTabs, setOpenThreadTabs] = useState<OpenThreadTab[]>([]);
  const hasLoadedThreadTabsRef = useRef(false);
  const [generatingThreadIds, setGeneratingThreadIds] = useState<Set<string>>(() => new Set());
  const [completedGenerationThreadIds, setCompletedGenerationThreadIds] = useState<Set<string>>(() => new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [regeneratingTitleThreadId, setRegeneratingTitleThreadId] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [isStatisticsOpen, setIsStatisticsOpen] = useState(false);
  const [isStatisticsLoading, setIsStatisticsLoading] = useState(false);
  const [statistics, setStatistics] = useState<StatisticsSummary | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiApiKeyStatus, setGeminiApiKeyStatus] = useState<GeminiApiKeyStatus | null>(null);
  const [isApiKeySaving, setIsApiKeySaving] = useState(false);
  const [apiKeyStatusMessage, setApiKeyStatusMessage] = useState("");
  const [isResidentPromptsOpen, setIsResidentPromptsOpen] = useState(false);
  const [promptTargetFeedId, setPromptTargetFeedId] = useState("");
  const [promptText, setPromptText] = useState("");
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [promptStatusMessage, setPromptStatusMessage] = useState("");
  const [promptVersions, setPromptVersions] = useState<ResidentPromptVersion[]>([]);
  const [hasPromptProposal, setHasPromptProposal] = useState(false);
  const [threadListHeight, setThreadListHeight] = useState(42);
  const [feedPaneWidth, setFeedPaneWidth] = useState(248);
  const [articlePaneWidth, setArticlePaneWidth] = useState(360);
  const [isArticlePaneVisible, setIsArticlePaneVisible] = useState(false);
  const [articleBody, setArticleBody] = useState<ArticleBodyContent | null>(null);
  const [isArticleBodyLoading, setIsArticleBodyLoading] = useState(false);
  const [threadColumnWidths, setThreadColumnWidths] = useState(defaultThreadColumnWidths);
  const appShellRef = useRef<HTMLDivElement>(null);
  const contentPaneRef = useRef<HTMLElement>(null);
  const threadContentRef = useRef<HTMLElement>(null);
  const [isAddFeedOpen, setIsAddFeedOpen] = useState(false);
  const [addFeedTitle, setAddFeedTitle] = useState("");
  const [addFeedUrl, setAddFeedUrl] = useState("");
  const [addFeedError, setAddFeedError] = useState("");
  const [isAddFeedLoading, setIsAddFeedLoading] = useState(false);
  const [replyName, setReplyName] = useState("");
  const [replyMail, setReplyMail] = useState("sage");
  const [replyBody, setReplyBody] = useState("");
  const replyDraftsRef = useRef<Map<string, string>>(new Map());
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [postStatus, setPostStatus] = useState<"idle" | "writing" | "generating" | "done" | "error">("idle");
  const [popupData, setPopupData] = useState<{
    title: string;
    posts: ThreadPost[];
    style: CSSProperties;
  } | null>(null);
  const [replyModel, setReplyModel] = useState("gemini-3.1-flash-lite");
  const popupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const replyBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [favoriteThreads, setFavoriteThreads] = useState<ThreadListItem[]>([]);
  const [isFavoriteCollapsed, setIsFavoriteCollapsed] = useState(false);
  const [readMarkerNo, setReadMarkerNo] = useState<number | null>(null);
  const [extractedPostId, setExtractedPostId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);

  const selectedFeed = selectedFeedId === allFeedsId
    ? { id: allFeedsId, title: "全板共通", url: "登録済みの全板・記事時刻の新しい順", unreadCount: feedList.reduce((sum, feed) => sum + feed.unreadCount, 0), lastFetchedAt: null }
    : feedList.find((feed) => feed.id === selectedFeedId) ?? feedList[0];
  const isSelectedThreadGenerating = selectedThread ? generatingThreadIds.has(selectedThread.id) : false;
  const isRegeneratingSelectedTitle = selectedThread ? regeneratingTitleThreadId === selectedThread.id : false;
  const shouldShowArticlePane = isArticlePaneVisible && Boolean(selectedThread && selectedThread.posts.length > 1);
  const threadGridColumns = threadColumnWidths.map((width) => `${width}px`).join(" ");
  const threadListMinWidth = threadColumnWidths.reduce((total, width) => total + width, 0);
  const visibleThreads = showUnreadOnly ? threadList.filter((thread) => !thread.isRead) : threadList;

  useEffect(() => {
    void reloadFeeds();
    void loadSettings();
    void loadFavoriteThreads();
  }, []);

  useEffect(() => {
    if (!hasLoadedThreadTabsRef.current || !window.viperReader) {
      return;
    }

    const session: ThreadTabsSession = {
      tabs: openThreadTabs,
      activeTabId: selectedThreadId ?? null
    };
    void window.viperReader.saveUserSetting("threadTabs", JSON.stringify(session));
  }, [openThreadTabs, selectedThreadId]);

  useEffect(() => {
    if (!window.viperReader) {
      return;
    }

    void window.viperReader.listLogs().then((initialLogs) => {
      setLogs(limitLogs(initialLogs));
    });

    return window.viperReader.onLogEntry((entry) => {
      setLogs((currentLogs) => limitLogs([...currentLogs, entry]));
    });
  }, []);

  useEffect(() => {
    if (!selectedFeedId) {
      setThreadList([]);
      setSelectedThreadId(undefined);
      setSelectedThread(null);
      return;
    }

    setThreadListPage(0);
    void reloadThreads(selectedFeedId, undefined, 0);
  }, [selectedFeedId, showUnreadOnly]);

  useEffect(() => {
    setReadMarkerNo(null);
    setExtractedPostId(null);
    if (!selectedThreadId || !window.viperReader) {
      setSelectedThread(null);
      return;
    }
    // スレッド切り替え時に書き込みフォームにフォーカスを当てる
    setTimeout(() => replyBodyRef.current?.focus(), 50);

    setCompletedGenerationThreadIds((currentIds) => {
      if (currentIds.has(selectedThreadId)) {
        const nextIds = new Set(currentIds);
        nextIds.delete(selectedThreadId);
        return nextIds;
      }
      return currentIds;
    });

    void window.viperReader
      .getThread(selectedThreadId)
      .then((thread) => {
        if (!thread) {
          if (selectedThreadIdRef.current === selectedThreadId) {
            closeThreadTab(selectedThreadId, true);
          }
          return;
        }
        setOpenThreadTabs((currentTabs) =>
          currentTabs.map((tab) =>
            tab.id === thread.id ? { ...tab, feedId: thread.feedId, title: thread.vipTitle } : tab
          )
        );
        setThreadList((currentThreads) =>
          currentThreads.map((currentThread) =>
            currentThread.id === thread.id ? { ...currentThread, ...thread, isRead: true } : currentThread
          )
        );
        void reloadFeeds();
        if (selectedThreadIdRef.current !== selectedThreadId) {
          return;
        }
        setSelectedThread(thread);
      })
      .catch(() => {
        if (selectedThreadIdRef.current === selectedThreadId) {
          setSelectedThread(null);
        }
      });
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !shouldShowArticlePane || !window.viperReader) {
      setArticleBody(null);
      setIsArticleBodyLoading(false);
      return;
    }

    const threadId = selectedThreadId;
    setArticleBody(null);
    setIsArticleBodyLoading(true);
    void window.viperReader.getArticleBody(threadId).then((body) => {
      if (selectedThreadIdRef.current === threadId) {
        setArticleBody(body);
      }
    }).finally(() => {
      if (selectedThreadIdRef.current === threadId) {
        setIsArticleBodyLoading(false);
      }
    });
  }, [selectedThreadId, shouldShowArticlePane, isSelectedThreadGenerating]);

  useEffect(() => {
    if (!window.viperReader) return;
    return window.viperReader.onPostStatus((data) => {
      if (data.status === "done" || data.status === "error") setIsPosting(false);
      if (data.threadId !== selectedThreadId) return;
      setPostStatus(data.status);
      if (data.status === "done" || data.status === "error") {
        if (data.status === "error") setPostError("AI住民のレス生成に失敗しました。書き込みは保存されています。");
        void window.viperReader?.getThread(data.threadId).then((thread) => {
          if (!thread) return;
          setSelectedThread(thread);
          setThreadList((current) => current.map((item) => item.id === thread.id ? { ...item, ...thread, isRead: true } : item));
        });
      }
    });
  }, [selectedThreadId]);

  useEffect(() => {
    if (!window.viperReader) return;
    return window.viperReader.onPromptProposalReady((data) => {
      setHasPromptProposal(true);
      setPromptStatusMessage("新しい住民プロンプト改善案ができました");
      if (isResidentPromptsOpen && data.feedId === promptTargetFeedId) {
        void window.viperReader?.listResidentPromptVersions(data.feedId).then(setPromptVersions);
      }
    });
  }, [isResidentPromptsOpen, promptTargetFeedId]);

  useEffect(() => {
    if (!window.viperReader) {
      return;
    }

    return window.viperReader.onThreadGenerationComplete((status) => {
      setGeneratingThreadIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(status.threadId);
        return nextIds;
      });

      if (status.status === "done") {
        if (status.threadId !== selectedThreadId) {
          setCompletedGenerationThreadIds((currentIds) => {
            const nextIds = new Set(currentIds);
            nextIds.add(status.threadId);
            return nextIds;
          });
        }

        void window.viperReader?.getThread(status.threadId).then((thread) => {
          if (thread) {
            setThreadList((currentThreads) =>
              currentThreads.map((currentThread) =>
                currentThread.id === thread.id ? { ...currentThread, ...thread, isRead: status.threadId === selectedThreadId ? true : currentThread.isRead } : currentThread
              )
            );
            if (status.threadId === selectedThreadId) {
              setSelectedThread(thread);
            }
          }
        });
      }
    });
  }, [selectedThreadId]);

  async function reloadFeeds() {
    if (!window.viperReader) {
      return;
    }

    const nextFeeds = await window.viperReader.listFeeds();
    setFeedList(nextFeeds);
    const versionGroups = await Promise.all(nextFeeds.map((feed) => window.viperReader!.listResidentPromptVersions(feed.id)));
    setHasPromptProposal(versionGroups.some((versions) => versions.some((version) => version.status === "pending")));

    setSelectedFeedId((currentFeedId) =>
      currentFeedId === allFeedsId || nextFeeds.some((feed) => feed.id === currentFeedId) ? currentFeedId : allFeedsId
    );
  }

  async function reloadThreads(feedId: string, preferredThreadId?: string, page = threadListPage) {
    if (!window.viperReader) {
      return;
    }

    const result = await window.viperReader.listThreads(feedId === allFeedsId ? null : feedId, page, showUnreadOnly);
    setThreadList(result.items);
    setThreadListPage(result.page);
    setThreadListTotalCount(result.totalCount);
    if (preferredThreadId && result.items.some((thread) => thread.id === preferredThreadId)) {
      setSelectedThreadId(preferredThreadId);
    }
  }

  function changeThreadListPage(nextPage: number) {
    if (!selectedFeedId || nextPage < 0) return;
    void reloadThreads(selectedFeedId, undefined, nextPage);
  }

  function openThreadTab(thread: ThreadListItem | ThreadDetail) {
    const tab: OpenThreadTab = {
      id: thread.id,
      feedId: thread.feedId,
      title: thread.vipTitle,
      isLocked: false
    };

    setOpenThreadTabs((currentTabs) =>
      currentTabs.some((currentTab) => currentTab.id === tab.id)
        ? currentTabs.map((currentTab) =>
            currentTab.id === tab.id
              ? { ...currentTab, feedId: tab.feedId, title: tab.title }
              : currentTab
          )
        : [...currentTabs, tab]
    );
    activateThreadTab(tab, selectedFeedId === allFeedsId ? allFeedsId : undefined);
  }

  function openThreadTabById(threadId: string) {
    const thread = threadList.find((candidate) => candidate.id === threadId);
    if (thread) {
      openThreadTab(thread);
    }
  }

  function activateThreadTab(tab: OpenThreadTab, feedSelection?: string) {
    if (selectedThreadId !== tab.id) {
      if (selectedThreadId) {
        replyDraftsRef.current.set(selectedThreadId, replyBody);
      }
      setReplyBody(replyDraftsRef.current.get(tab.id) ?? "");
      setPostError("");
      setPostStatus("idle");
      setSelectedThread(null);
      setPopupData(null);
    }
    setSelectedFeedId(feedSelection ?? tab.feedId);
    setSelectedThreadId(tab.id);
  }

  function closeThreadTab(tabId: string, force = false) {
    const tabIndex = openThreadTabs.findIndex((tab) => tab.id === tabId);
    if (tabIndex < 0 || (!force && openThreadTabs[tabIndex].isLocked)) {
      return;
    }

    const nextTabs = openThreadTabs.filter((tab) => tab.id !== tabId);
    replyDraftsRef.current.delete(tabId);
    setOpenThreadTabs(nextTabs);

    if (selectedThreadId !== tabId) {
      return;
    }

    const nextActiveTab = nextTabs[Math.min(tabIndex, nextTabs.length - 1)];
    if (nextActiveTab) {
      activateThreadTab(nextActiveTab);
    } else {
      setSelectedThreadId(undefined);
      setSelectedThread(null);
    }
  }

  function toggleThreadTabLock(tabId: string) {
    setOpenThreadTabs((currentTabs) =>
      currentTabs.map((tab) => tab.id === tabId ? { ...tab, isLocked: !tab.isLocked } : tab)
    );
  }

  function moveThreadTab(sourceTabId: string, targetTabId: string) {
    setOpenThreadTabs((currentTabs) => {
      const sourceIndex = currentTabs.findIndex((tab) => tab.id === sourceTabId);
      const targetIndex = currentTabs.findIndex((tab) => tab.id === targetTabId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return currentTabs;
      }

      const nextTabs = [...currentTabs];
      const [sourceTab] = nextTabs.splice(sourceIndex, 1);
      nextTabs.splice(targetIndex, 0, sourceTab);
      return nextTabs;
    });
  }

  function activateRelativeThreadTab(delta: -1 | 1) {
    if (openThreadTabs.length === 0) {
      return;
    }

    const currentIndex = openThreadTabs.findIndex((tab) => tab.id === selectedThreadId);
    const baseIndex = currentIndex < 0 ? 0 : currentIndex;
    const nextIndex = (baseIndex + delta + openThreadTabs.length) % openThreadTabs.length;
    activateThreadTab(openThreadTabs[nextIndex]);
  }

  async function markAllThreadsRead() {
    if (!window.viperReader || !selectedFeedId) return;
    if (selectedFeedId === allFeedsId) {
      await window.viperReader.markAllFeedsRead();
    } else {
      await window.viperReader.markFeedRead(selectedFeedId);
    }
    setThreadList((threads) => threads.map((thread) => ({ ...thread, isRead: true })));
    if (showUnreadOnly) setThreadListTotalCount(0);
    await reloadFeeds();
  }

  async function toggleSelectedThreadRead() {
    if (!window.viperReader || !selectedThreadId) return;
    const item = threadList.find((thread) => thread.id === selectedThreadId);
    if (!item) return;
    const isRead = !item.isRead;
    await window.viperReader.setThreadRead(item.id, isRead);
    setThreadList((threads) => threads.map((thread) => thread.id === item.id ? { ...thread, isRead } : thread));
    setSelectedThread((thread) => thread?.id === item.id ? { ...thread, isRead } : thread);
    await reloadFeeds();
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const primaryModifier = event.ctrlKey || event.metaKey;

      if (primaryModifier && event.key.toLowerCase() === "w") {
        event.preventDefault();
        if (selectedThreadId) closeThreadTab(selectedThreadId);
        return;
      }

      if (event.ctrlKey && event.key === "Tab") {
        event.preventDefault();
        activateRelativeThreadTab(event.shiftKey ? -1 : 1);
        return;
      }

      if (event.key === "Escape" && extractedPostId) {
        event.preventDefault();
        setExtractedPostId(null);
        return;
      }

      if (target?.matches("input, textarea, select, [contenteditable='true']") || primaryModifier || event.altKey) return;
      const index = visibleThreads.findIndex((thread) => thread.id === selectedThreadId);
      if (event.key === "j" || event.key === "k") {
        const delta = event.key === "j" ? 1 : -1;
        const nextIndex = index < 0 ? (delta > 0 ? 0 : visibleThreads.length - 1) : index + delta;
        const next = visibleThreads[nextIndex];
        if (next) { event.preventDefault(); openThreadTab(next); }
      } else if (event.key === "r") {
        event.preventDefault(); void refreshSelectedFeed();
      } else if (event.key === "g") {
        event.preventDefault(); void generateResponses(false);
      } else if (event.key === "b") {
        event.preventDefault(); void toggleFavorite();
      } else if (event.key === "u") {
        event.preventDefault(); void toggleSelectedThreadRead();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visibleThreads, selectedThreadId, selectedThread, selectedFeedId, isRefreshing, isSelectedThreadGenerating, openThreadTabs, extractedPostId]);

  async function loadSettings() {
    if (!window.viperReader) {
      return;
    }

    try {
      const [height, widthsJson, model, threadTabsJson, savedFeedPaneWidth, savedArticlePaneWidth, savedArticlePaneVisible] = await Promise.all([
        window.viperReader.getUserSetting("threadListHeight"),
        window.viperReader.getUserSetting("threadColumnWidths"),
        window.viperReader.getUserSetting("replyModel"),
        window.viperReader.getUserSetting("threadTabs"),
        window.viperReader.getUserSetting("feedPaneWidth"),
        window.viperReader.getUserSetting("articlePaneWidth"),
        window.viperReader.getUserSetting("articlePaneVisible")
      ]);

      if (height) {
        setThreadListHeight(parseFloat(height));
      }

      if (widthsJson) {
        const widths = JSON.parse(widthsJson) as unknown;
        if (Array.isArray(widths) && widths.length === defaultThreadColumnWidths.length) {
          setThreadColumnWidths(widths as number[]);
        }
      }

      if (model) {
        setReplyModel(model);
      }

      if (savedFeedPaneWidth) {
        const width = Number.parseFloat(savedFeedPaneWidth);
        if (Number.isFinite(width)) {
          setFeedPaneWidth(Math.min(480, Math.max(180, width)));
        }
      }

      if (savedArticlePaneWidth) {
        const width = Number.parseFloat(savedArticlePaneWidth);
        if (Number.isFinite(width)) {
          setArticlePaneWidth(Math.min(640, Math.max(260, width)));
        }
      }
      setIsArticlePaneVisible(savedArticlePaneVisible === "true");

      const restoredSession = parseThreadTabsSession(threadTabsJson);
      setOpenThreadTabs(restoredSession.tabs);
      const activeTab = restoredSession.tabs.find((tab) => tab.id === restoredSession.activeTabId)
        ?? restoredSession.tabs[0];
      if (activeTab) {
        setSelectedFeedId(activeTab.feedId);
        setSelectedThreadId(activeTab.id);
      }
    } catch (err) {
      console.error("ユーザー設定の読込に失敗しました:", err);
    } finally {
      hasLoadedThreadTabsRef.current = true;
    }
  }

  async function handleReplyModelChange(newModel: string) {
    setReplyModel(newModel);
    if (window.viperReader) {
      await window.viperReader.saveUserSetting("replyModel", newModel);
    }
  }

  async function openSettings() {
    setIsSettingsOpen(true);
    setGeminiApiKey("");
    setApiKeyStatusMessage("");

    if (!window.viperReader) {
      setGeminiApiKeyStatus(null);
      return;
    }

    try {
      setGeminiApiKeyStatus(await window.viperReader.getGeminiApiKeyStatus());
    } catch (err) {
      setApiKeyStatusMessage(err instanceof Error ? err.message : "API キー設定の読込に失敗しました。");
    }
  }

  async function saveApiKey() {
    if (!window.viperReader || !geminiApiKey.trim()) {
      return;
    }

    setIsApiKeySaving(true);
    setApiKeyStatusMessage("");
    try {
      setGeminiApiKeyStatus(await window.viperReader.saveGeminiApiKey(geminiApiKey));
      setGeminiApiKey("");
      setApiKeyStatusMessage("API キーをローカル設定へ保存しました。");
    } catch (err) {
      setApiKeyStatusMessage(err instanceof Error ? err.message : "API キーの保存に失敗しました。");
    } finally {
      setIsApiKeySaving(false);
    }
  }

  async function clearApiKey() {
    if (!window.viperReader) {
      return;
    }

    setIsApiKeySaving(true);
    setApiKeyStatusMessage("");
    try {
      const status = await window.viperReader.clearGeminiApiKey();
      setGeminiApiKeyStatus(status);
      setGeminiApiKey("");
      setApiKeyStatusMessage(status.source === "environment"
        ? "ローカル設定のキーを削除しました。環境変数のキーへ切り替わりました。"
        : "保存済みの API キーを削除しました。");
    } catch (err) {
      setApiKeyStatusMessage(err instanceof Error ? err.message : "API キーの削除に失敗しました。");
    } finally {
      setIsApiKeySaving(false);
    }
  }

  function selectFeed(feedId: string) {
    setSelectedFeedId(feedId);
    setRefreshMessage("");
  }

  async function addFeed() {
    if (!window.viperReader || !addFeedTitle.trim() || !addFeedUrl.trim()) {
      return;
    }

    setIsAddFeedLoading(true);
    setAddFeedError("");
    try {
      const newFeed = await window.viperReader.addFeedSource(addFeedTitle.trim(), addFeedUrl.trim());
      setFeedList((current) => [...current, newFeed]);
      setSelectedFeedId(newFeed.id);
      setIsAddFeedOpen(false);
      setAddFeedTitle("");
      setAddFeedUrl("");
    } catch (err) {
      setAddFeedError(err instanceof Error ? err.message : "追加に失敗しました。");
    } finally {
      setIsAddFeedLoading(false);
    }
  }

  async function deleteSelectedFeed() {
    if (!selectedFeedId || selectedFeedId === allFeedsId || !window.viperReader) {
      return;
    }

    const feedToDelete = feedList.find((f) => f.id === selectedFeedId);
    if (!feedToDelete) {
      return;
    }

    if (
      !confirm(
        `板「${feedToDelete.title}」を削除しますか？\n（この板に含まれるすべての記事やキャッシュも消去されます）`
      )
    ) {
      return;
    }

    try {
      await window.viperReader.deleteFeedSource(selectedFeedId);
      const remainingTabs = openThreadTabs.filter((tab) => tab.feedId !== selectedFeedId);
      const activeTabWasDeleted = openThreadTabs.some(
        (tab) => tab.id === selectedThreadId && tab.feedId === selectedFeedId
      );
      setOpenThreadTabs(remainingTabs);
      if (activeTabWasDeleted) {
        const nextActiveTab = remainingTabs[0];
        if (nextActiveTab) {
          activateThreadTab(nextActiveTab);
        } else {
          setSelectedThreadId(undefined);
          setSelectedThread(null);
        }
      }
      setFeedList((current) => {
        const next = current.filter((feed) => feed.id !== selectedFeedId);
        if (next.length > 0) {
          setSelectedFeedId(next[0].id);
        } else {
          setSelectedFeedId("");
        }
        return next;
      });
    } catch (err) {
      alert("削除に失敗しました。");
    }
  }

  async function openStatistics() {
    setIsStatisticsOpen(true);

    if (!window.viperReader) {
      setStatistics(null);
      return;
    }

    setIsStatisticsLoading(true);
    try {
      setStatistics(await window.viperReader.getStatistics());
    } finally {
      setIsStatisticsLoading(false);
    }
  }

  useEffect(() => {
    if (!isResidentPromptsOpen || !promptTargetFeedId || !window.viperReader) {
      return;
    }

    setIsPromptLoading(true);
    setPromptStatusMessage("");
    void Promise.all([
      window.viperReader.getFeedResidentPrompt(promptTargetFeedId),
      window.viperReader.listResidentPromptVersions(promptTargetFeedId)
    ])
      .then(([res, versions]) => {
        setPromptText(res?.prompt ?? "");
        setPromptVersions(versions);
        setHasPromptProposal(versions.some((version) => version.status === "pending"));
      })
      .catch((err) => {
        setPromptStatusMessage(err instanceof Error ? `読込失敗: ${err.message}` : "読込失敗");
      })
      .finally(() => {
        setIsPromptLoading(false);
      });
  }, [isResidentPromptsOpen, promptTargetFeedId]);

  function openResidentPrompts() {
    setIsResidentPromptsOpen(true);
    setPromptTargetFeedId(selectedFeedId || feedList[0]?.id || "");
    setPromptStatusMessage("");
  }

  async function savePrompt() {
    if (!window.viperReader || !promptTargetFeedId || isPromptLoading) {
      return;
    }

    setIsPromptLoading(true);
    setPromptStatusMessage("");
    try {
      if (promptText.trim() === "") {
        await window.viperReader.clearFeedResidentPrompt(promptTargetFeedId);
        setPromptStatusMessage("クリアしました（デフォルトに戻りました）");
      } else {
        await window.viperReader.saveFeedResidentPrompt(promptTargetFeedId, promptText);
        setPromptStatusMessage("保存しました");
      }
      setPromptVersions(await window.viperReader.listResidentPromptVersions(promptTargetFeedId));
      setHasPromptProposal(false);
      await reloadFeeds();
    } catch (err) {
      setPromptStatusMessage(err instanceof Error ? `保存失敗: ${err.message}` : "保存失敗");
    } finally {
      setIsPromptLoading(false);
    }
  }

  async function clearPrompt() {
    if (!window.viperReader || !promptTargetFeedId || isPromptLoading) {
      return;
    }

    setIsPromptLoading(true);
    setPromptStatusMessage("");
    try {
      await window.viperReader.clearFeedResidentPrompt(promptTargetFeedId);
      setPromptText("");
      setPromptStatusMessage("クリアしました（デフォルトに戻りました）");
      setPromptVersions(await window.viperReader.listResidentPromptVersions(promptTargetFeedId));
      setHasPromptProposal(false);
      await reloadFeeds();
    } catch (err) {
      setPromptStatusMessage(err instanceof Error ? `クリア失敗: ${err.message}` : "クリア失敗");
    } finally {
      setIsPromptLoading(false);
    }
  }

  async function reviewPromptVersion(id: string, decision: "active" | "rejected") {
    if (!window.viperReader || !promptTargetFeedId) return;
    setIsPromptLoading(true);
    try {
      await window.viperReader.reviewResidentPromptVersion(id, decision);
      setPromptVersions(await window.viperReader.listResidentPromptVersions(promptTargetFeedId));
      await reloadFeeds();
      setPromptStatusMessage(decision === "active" ? "改善案を採用しました" : "改善案を却下しました");
    } catch (err) {
      setPromptStatusMessage(err instanceof Error ? err.message : "改善案の更新に失敗しました");
    } finally { setIsPromptLoading(false); }
  }

  async function rollbackPromptVersion() {
    if (!window.viperReader || !promptTargetFeedId) return;
    setIsPromptLoading(true);
    try {
      await window.viperReader.rollbackResidentPromptVersion(promptTargetFeedId);
      setPromptVersions(await window.viperReader.listResidentPromptVersions(promptTargetFeedId));
      setPromptStatusMessage("一つ前の改善版に戻しました");
    } catch (err) {
      setPromptStatusMessage(err instanceof Error ? err.message : "ロールバックに失敗しました");
    } finally { setIsPromptLoading(false); }
  }

  async function rateReplyRun(runId: string, rating: ReplyRating, tags: string[]) {
    if (!window.viperReader || !selectedThread) return;
    const threadId = selectedThread.id;
    try {
      await window.viperReader.rateReplyRun(runId, rating, tags);
      setSelectedThread((current) => current?.id === threadId ? {
        ...current,
        replyRuns: current.replyRuns.map((run) => run.id === runId ? { ...run, rating, feedbackTags: tags } : run)
      } : current);
    } catch (err) {
      if (selectedThreadIdRef.current === threadId) {
        setPostError(err instanceof Error ? err.message : "レス評価の保存に失敗しました。");
      }
    }
  }

  function replyToPost(postNo: number) {
    const anchor = `>>${postNo}\n`;
    setReplyBody((current) => current.startsWith(anchor) ? current : `${anchor}${current}`);
    setTimeout(() => replyBodyRef.current?.focus(), 0);
  }

  async function refreshFeed(feedId: string) {
    if (!window.viperReader || !feedId || isRefreshing) {
      return;
    }

    const preferredThreadId = threadList.some(
      (thread) => thread.feedId === feedId && thread.id === selectedThreadId
    )
      ? selectedThreadId
      : undefined;

    setIsRefreshing(true);
    setRefreshMessage("RSS取得中...");
    const unsubscribeProgress = window.viperReader.onRefreshProgress((progress) => {
      if (progress.feedId === feedId) {
        setRefreshMessage(progress.message);
      }
    });

    try {
      const result = await window.viperReader.refreshFeed(feedId);
      await reloadFeeds();
      await reloadThreads(feedId, preferredThreadId);
      setRefreshMessage(
        `取得:${result.fetchedCount} 新規:${result.insertedCount} 更新:${result.updatedCount} 既存:${result.skippedCount} 変換:${result.convertedCount} 失敗:${result.conversionFailedCount} 未変換:${result.conversionSkippedCount}`
      );
    } catch (error) {
      setRefreshMessage(error instanceof Error ? `取得失敗: ${error.message}` : "取得失敗");
    } finally {
      unsubscribeProgress();
      setIsRefreshing(false);
    }
  }

  async function refreshSelectedFeed() {
    if (selectedFeedId === allFeedsId) {
      await refreshAllFeeds();
    } else if (selectedFeed) {
      await refreshFeed(selectedFeed.id);
    }
  }

  async function refreshAllFeeds() {
    if (!window.viperReader || feedList.length === 0 || isRefreshing) {
      return;
    }

    const feedsToRefresh = [...feedList];
    const totals = {
      fetchedCount: 0,
      insertedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      convertedCount: 0,
      conversionFailedCount: 0,
      conversionSkippedCount: 0
    };
    const failedFeeds: string[] = [];
    let currentFeedId = "";
    let currentFeedIndex = 0;

    setIsRefreshing(true);
    setRefreshMessage(`全板更新を開始...（0/${feedsToRefresh.length}板）`);
    const unsubscribeProgress = window.viperReader.onRefreshProgress((progress) => {
      if (progress.feedId === currentFeedId) {
        const feed = feedsToRefresh[currentFeedIndex];
        setRefreshMessage(`全板更新 ${currentFeedIndex + 1}/${feedsToRefresh.length}板「${feed.title}」: ${progress.message}`);
      }
    });

    try {
      for (const [index, feed] of feedsToRefresh.entries()) {
        currentFeedId = feed.id;
        currentFeedIndex = index;
        setRefreshMessage(`全板更新 ${index + 1}/${feedsToRefresh.length}板「${feed.title}」: RSS取得中...`);
        try {
          const result = await window.viperReader.refreshFeed(feed.id);
          totals.fetchedCount += result.fetchedCount;
          totals.insertedCount += result.insertedCount;
          totals.updatedCount += result.updatedCount;
          totals.skippedCount += result.skippedCount;
          totals.convertedCount += result.convertedCount;
          totals.conversionFailedCount += result.conversionFailedCount;
          totals.conversionSkippedCount += result.conversionSkippedCount;
        } catch {
          failedFeeds.push(feed.title);
        }
      }

      await reloadFeeds();
      await reloadThreads(allFeedsId, selectedThreadId);
      const failureSummary = failedFeeds.length > 0 ? ` 更新失敗:${failedFeeds.length}板（${failedFeeds.join("、")}）` : "";
      setRefreshMessage(
        `全${feedsToRefresh.length}板完了 取得:${totals.fetchedCount} 新規:${totals.insertedCount} 更新:${totals.updatedCount} 既存:${totals.skippedCount} 変換:${totals.convertedCount} 失敗:${totals.conversionFailedCount} 未変換:${totals.conversionSkippedCount}${failureSummary}`
      );
    } finally {
      unsubscribeProgress();
      setIsRefreshing(false);
    }
  }

  async function generateResponses(force = false) {
    if (!selectedThread || !window.viperReader || isSelectedThreadGenerating) {
      return;
    }

    setGeneratingThreadIds((currentIds) => {
      const nextIds = new Set(currentIds);
      nextIds.add(selectedThread.id);
      return nextIds;
    });

    try {
      await window.viperReader.generateThreadResponses(selectedThread.id, force);
    } catch (err) {
      setGeneratingThreadIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(selectedThread.id);
        return nextIds;
      });
    }
  }

  async function regenerateSelectedVipTitle() {
    if (!selectedThread || !window.viperReader || regeneratingTitleThreadId) {
      return;
    }

    const threadId = selectedThread.id;
    setRegeneratingTitleThreadId(threadId);
    setPostError("");

    try {
      const result = await window.viperReader.regenerateVipTitle(threadId);
      if (result) {
        if (selectedThreadIdRef.current === threadId) {
          setSelectedThread(result);
        }
        setOpenThreadTabs((currentTabs) =>
          currentTabs.map((tab) => tab.id === result.id ? { ...tab, title: result.vipTitle } : tab)
        );
        setThreadList((currentThreads) =>
          currentThreads.map((currentThread) =>
            currentThread.id === result.id ? { ...currentThread, ...result, isRead: true } : currentThread
          )
        );
      }
    } catch (err) {
      if (selectedThreadIdRef.current === threadId) {
        setPostError(err instanceof Error ? err.message : "スレタイ再生成に失敗しました。");
      }
    } finally {
      setRegeneratingTitleThreadId(null);
    }
  }

  async function handlePostMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedThread || !window.viperReader || isPosting || !replyBody.trim()) {
      return;
    }

    const threadId = selectedThread.id;
    // 書き込み前の最後のレス番号を記録してセパレーターに使う
    const markerNo = selectedThread.posts.reduce((max, p) => Math.max(max, p.no), 0);

    setIsPosting(true);
    setPostError("");
    setPostStatus("idle");

    try {
      const result = await window.viperReader.postMessage(
        threadId,
        replyName,
        replyMail,
        replyBody
      );

      if (result) {
        replyDraftsRef.current.delete(result.id);
        if (selectedThreadIdRef.current === threadId) {
          setReadMarkerNo(markerNo);
          setSelectedThread(result);
          setReplyBody("");
        }
        // スレッド一覧のレス数や既読を更新
        setThreadList((currentThreads) =>
          currentThreads.map((currentThread) =>
            currentThread.id === result.id ? { ...currentThread, ...result, isRead: true } : currentThread
          )
        );
        void reloadFeeds();

        if (selectedThreadIdRef.current === threadId) {
          scrollReadMarkerToTop();
        }
      }
    } catch (err) {
      if (selectedThreadIdRef.current === threadId) {
        setPostError(err instanceof Error ? err.message : "書き込みに失敗しました。");
      }
      setIsPosting(false);
      if (selectedThreadIdRef.current === threadId) {
        setPostStatus("idle");
      }
    }
  }

  async function handleGenerateReplies() {
    if (!selectedThread || !window.viperReader || isPosting) return;

    const threadId = selectedThread.id;
    // 再読み込み前の最後のレス番号を記録してセパレーターに使う
    const markerNo = selectedThread.posts.reduce((max, p) => Math.max(max, p.no), 0);

    setIsPosting(true);
    setPostError("");

    const unsubscribePostStatus = window.viperReader.onPostStatus((data) => {
      if (data.threadId === threadId && selectedThreadIdRef.current === threadId) {
        setPostStatus(data.status);
      }
    });

    try {
      const result = await window.viperReader.generateReplies(threadId);
      if (result) {
        if (selectedThreadIdRef.current === threadId) {
          setReadMarkerNo(markerNo);
          setSelectedThread(result);
        }
        
        setThreadList((currentThreads) =>
          currentThreads.map((currentThread) =>
            currentThread.id === result.id ? { ...currentThread, ...result, isRead: true } : currentThread
          )
        );
        void reloadFeeds();

        if (selectedThreadIdRef.current === threadId) {
          scrollReadMarkerToTop();
        }
      }
    } catch (err) {
      if (selectedThreadIdRef.current === threadId) {
        setPostError(err instanceof Error ? err.message : "レス生成に失敗しました。");
      }
    } finally {
      unsubscribePostStatus();
      setIsPosting(false);
      setPostStatus("idle");
    }
  }

  async function loadFavoriteThreads() {
    if (!window.viperReader) return;
    try {
      const favs = await window.viperReader.listFavoriteThreads();
      setFavoriteThreads(favs);
    } catch (err) {
      console.error("お気に入りスレッドの読み込みに失敗しました:", err);
    }
  }

  async function toggleFavorite() {
    if (!selectedThread || !window.viperReader) return;
    const threadId = selectedThread.id;
    const nextFavorite = !selectedThread.isFavorite;
    try {
      await window.viperReader.toggleFavorite(threadId, nextFavorite);
      
      setSelectedThread((current) => current?.id === threadId ? { ...current, isFavorite: nextFavorite } : current);
      
      setThreadList((currentList) =>
        currentList.map((item) =>
          item.id === threadId ? { ...item, isFavorite: nextFavorite } : item
        )
      );

      void loadFavoriteThreads();
    } catch (err) {
      console.error("お気に入りの更新に失敗しました:", err);
    }
  }

  function handleSelectFavoriteThread(thread: ThreadListItem) {
    openThreadTab(thread);
  }

  function scrollToPost(postNo: number) {
    function scrollToVisiblePost() {
      const element = document.getElementById(`post-${postNo}`);
      if (!element) return;
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      element.classList.add("highlighted-post");
      setTimeout(() => element.classList.remove("highlighted-post"), 2000);
    }

    const targetPost = selectedThread?.posts.find((post) => post.no === postNo);
    if (extractedPostId && targetPost?.id !== extractedPostId) {
      setExtractedPostId(null);
      setTimeout(scrollToVisiblePost, 0);
    } else {
      scrollToVisiblePost();
    }
  }

  function clearPopupTimeout() {
    if (popupTimeoutRef.current) {
      clearTimeout(popupTimeoutRef.current);
      popupTimeoutRef.current = null;
    }
  }

  function handleMouseLeaveWithDelay() {
    clearPopupTimeout();
    popupTimeoutRef.current = setTimeout(() => {
      setPopupData(null);
    }, 200);
  }

  function handlePostNoMouseEnter(postNo: number, event: ReactMouseEvent<HTMLElement>) {
    if (!selectedThread) return;
    clearPopupTimeout();

    const regex = new RegExp(`>>${postNo}(?!\\d)`);
    const replies = selectedThread.posts.filter((post) => regex.test(post.body));

    if (replies.length === 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 4;

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const popupMaxWidth = 480;
    const popupMaxHeight = 300;

    if (left + popupMaxWidth > screenWidth) {
      left = screenWidth - popupMaxWidth - 16;
    }
    if (left < 0) left = 8;

    if (top + popupMaxHeight > screenHeight) {
      top = rect.top - popupMaxHeight - 4;
      if (top < 0) {
        top = screenHeight - popupMaxHeight - 16;
      }
    }

    setPopupData({
      title: `>>${postNo} への返信レス (${replies.length}件)`,
      posts: replies,
      style: {
        left: `${left}px`,
        top: `${top}px`
      }
    });
  }

  function handlePostNoMouseLeave() {
    handleMouseLeaveWithDelay();
  }

  function handleAnchorMouseEnter(postNo: number, event: ReactMouseEvent<HTMLElement>) {
    if (!selectedThread) return;
    clearPopupTimeout();

    const targetPost = selectedThread.posts.find((post) => post.no === postNo);
    if (!targetPost) return;

    const rect = event.currentTarget.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 4;

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const popupMaxWidth = 480;
    const popupMaxHeight = 150; // 単体のプレビューなので少し低めに

    if (left + popupMaxWidth > screenWidth) {
      left = screenWidth - popupMaxWidth - 16;
    }
    if (left < 0) left = 8;

    if (top + popupMaxHeight > screenHeight) {
      top = rect.top - popupMaxHeight - 4;
      if (top < 0) {
        top = screenHeight - popupMaxHeight - 16;
      }
    }

    setPopupData({
      title: `>>${postNo} の内容`,
      posts: [targetPost],
      style: {
        left: `${left}px`,
        top: `${top}px`
      }
    });
  }

  function handleAnchorMouseLeave() {
    handleMouseLeaveWithDelay();
  }

  function handlePostIdMouseEnter(postId: string, event: ReactMouseEvent<HTMLElement>) {
    if (!selectedThread) return;
    clearPopupTimeout();

    const posts = selectedThread.posts.filter((post) => post.id === postId);
    if (posts.length === 0) return;

    const rect = event.currentTarget.getBoundingClientRect();
    let left = rect.left;
    let top = rect.bottom + 4;
    const popupMaxWidth = 480;
    const popupMaxHeight = 300;

    if (left + popupMaxWidth > window.innerWidth) {
      left = window.innerWidth - popupMaxWidth - 16;
    }
    if (left < 0) left = 8;

    if (top + popupMaxHeight > window.innerHeight) {
      top = rect.top - popupMaxHeight - 4;
      if (top < 0) {
        top = window.innerHeight - popupMaxHeight - 16;
      }
    }

    setPopupData({
      title: `ID:${postId} の発言 (${posts.length}/${selectedThread.posts.length})`,
      posts,
      style: {
        left: `${left}px`,
        top: `${top}px`
      }
    });
  }

  function handleExtractPostId(postId: string) {
    setPopupData(null);
    setExtractedPostId((currentId) => currentId === postId ? null : postId);
    setTimeout(() => {
      const postsContainer = document.querySelector<HTMLElement>(".posts");
      if (postsContainer) postsContainer.scrollTop = 0;
    }, 0);
  }

  function startVerticalResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const contentPane = contentPaneRef.current;
    if (!contentPane) {
      return;
    }

    const rect = contentPane.getBoundingClientRect();
    let currentHeight = threadListHeight;

    function handleMouseMove(moveEvent: MouseEvent) {
      const nextHeight = ((moveEvent.clientY - rect.top) / rect.height) * 100;
      currentHeight = Math.min(72, Math.max(24, nextHeight));
      setThreadListHeight(currentHeight);
    }

    function stopResize() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.classList.remove("is-resizing");
      void window.viperReader?.saveUserSetting("threadListHeight", currentHeight.toString());
    }

    document.body.classList.add("is-resizing");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
  }

  function startFeedPaneResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const appShell = appShellRef.current;
    if (!appShell) {
      return;
    }

    const rect = appShell.getBoundingClientRect();
    let currentWidth = feedPaneWidth;

    function handleMouseMove(moveEvent: MouseEvent) {
      const maxWidth = Math.max(180, Math.min(480, rect.width - 600));
      currentWidth = Math.min(maxWidth, Math.max(180, moveEvent.clientX - rect.left));
      setFeedPaneWidth(currentWidth);
    }

    function stopResize() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.classList.remove("is-feed-pane-resizing");
      void window.viperReader?.saveUserSetting("feedPaneWidth", currentWidth.toString());
    }

    document.body.classList.add("is-feed-pane-resizing");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
  }

  function startThreadColumnResize(columnIndex: number, event: ReactMouseEvent<HTMLSpanElement>) {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startWidths = [...threadColumnWidths];
    let currentWidths = [...threadColumnWidths];

    function handleMouseMove(moveEvent: MouseEvent) {
      const delta = moveEvent.clientX - startX;
      const nextWidth = Math.max(minThreadColumnWidths[columnIndex], startWidths[columnIndex] + delta);
      currentWidths = [...startWidths];
      currentWidths[columnIndex] = nextWidth;
      setThreadColumnWidths(currentWidths);
    }

    function stopResize() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.classList.remove("is-column-resizing");
      void window.viperReader?.saveUserSetting("threadColumnWidths", JSON.stringify(currentWidths));
    }

    document.body.classList.add("is-column-resizing");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
  }

  function startArticlePaneResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();

    const container = threadContentRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    let currentWidth = articlePaneWidth;

    function handleMouseMove(moveEvent: MouseEvent) {
      const maxWidth = Math.max(260, Math.min(640, rect.width - 420));
      currentWidth = Math.min(maxWidth, Math.max(260, rect.right - moveEvent.clientX));
      setArticlePaneWidth(currentWidth);
    }

    function stopResize() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.classList.remove("is-article-pane-resizing");
      void window.viperReader?.saveUserSetting("articlePaneWidth", currentWidth.toString());
    }

    document.body.classList.add("is-article-pane-resizing");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
  }

  function toggleArticlePane() {
    setIsArticlePaneVisible((current) => {
      const next = !current;
      void window.viperReader?.saveUserSetting("articlePaneVisible", String(next));
      return next;
    });
  }

  return (
    <main className="app-frame">
      <MenuBar
        replyModel={replyModel}
        onReplyModelChange={(model) => void handleReplyModelChange(model)}
        onOpenSettings={() => void openSettings()}
        onOpenStatistics={openStatistics}
        onOpenResidentPrompts={openResidentPrompts}
        hasPromptProposal={hasPromptProposal}
      />

      <div
        className="app-shell"
        ref={appShellRef}
        style={{ "--feed-pane-width": `${feedPaneWidth}px` } as CSSProperties}
      >
        <FeedPane
          feeds={feedList}
          favoriteThreads={favoriteThreads}
          logs={logs}
          selectedFeedId={selectedFeedId}
          selectedThreadId={selectedThreadId}
          isFavoriteCollapsed={isFavoriteCollapsed}
          onSelectFeed={selectFeed}
          onRefreshFeed={(feedId) => void refreshFeed(feedId)}
          onAddFeed={() => setIsAddFeedOpen(true)}
          onDeleteSelectedFeed={() => void deleteSelectedFeed()}
          onToggleFavoriteCollapsed={() => setIsFavoriteCollapsed((current) => !current)}
          onSelectFavoriteThread={handleSelectFavoriteThread}
          allFeedsId={allFeedsId}
          allUnreadCount={feedList.reduce((sum, feed) => sum + feed.unreadCount, 0)}
        />

        <div
          aria-label="板一覧とコンテンツの境界"
          aria-orientation="vertical"
          className="feed-pane-splitter"
          onMouseDown={startFeedPaneResize}
          role="separator"
        />

        <section
          className="content-pane"
          ref={contentPaneRef}
          style={{ "--thread-list-height": `${threadListHeight}%` } as CSSProperties}
        >
          <ThreadListPane
            selectedFeed={selectedFeed}
            selectedThread={selectedThread}
            threads={visibleThreads}
            generatingThreadIds={generatingThreadIds}
            completedThreadIds={completedGenerationThreadIds}
            isRefreshing={isRefreshing}
            refreshMessage={refreshMessage}
            showUnreadOnly={showUnreadOnly}
            threadColumnLabels={threadColumnLabels}
            threadGridColumns={threadGridColumns}
            threadListMinWidth={threadListMinWidth}
            onRefresh={() => void refreshSelectedFeed()}
            onSelectThread={openThreadTabById}
            onToggleUnreadOnly={() => setShowUnreadOnly((current) => !current)}
            onMarkAllRead={() => void markAllThreadsRead()}
            onStartColumnResize={startThreadColumnResize}
            canRefresh={selectedFeedId !== allFeedsId || feedList.length > 0}
            refreshLabel={selectedFeedId === allFeedsId ? "全板更新" : "更新"}
            page={threadListPage}
            pageSize={100}
            totalCount={threadListTotalCount}
            onPreviousPage={() => changeThreadListPage(threadListPage - 1)}
            onNextPage={() => changeThreadListPage(threadListPage + 1)}
          />

          <div
            aria-label="スレタイ一覧とスレ本文の境界"
            className="pane-splitter"
            onMouseDown={startVerticalResize}
            role="separator"
          />

          <section className="thread-workspace">
            <ThreadTabs
              tabs={openThreadTabs}
              activeTabId={selectedThreadId}
              generatingThreadIds={generatingThreadIds}
              completedThreadIds={completedGenerationThreadIds}
              onActivate={activateThreadTab}
              onClose={closeThreadTab}
              onToggleLock={toggleThreadTabLock}
              onMove={moveThreadTab}
            />
            <section
              className={`thread-content ${shouldShowArticlePane ? "has-article-pane" : ""}`}
              ref={threadContentRef}
              style={{ "--article-pane-width": `${articlePaneWidth}px` } as CSSProperties}
            >
              <ThreadReaderPane
                selectedThread={selectedThread}
                isSelectedThreadGenerating={isSelectedThreadGenerating}
                isRegeneratingTitle={isRegeneratingSelectedTitle}
                isPosting={isPosting}
                postStatus={postStatus}
                postError={postError}
                replyName={replyName}
                replyMail={replyMail}
                replyBody={replyBody}
                readMarkerNo={readMarkerNo}
                extractedPostId={extractedPostId}
                replyBodyRef={replyBodyRef}
                onToggleFavorite={() => void toggleFavorite()}
                onRegenerateVipTitle={() => void regenerateSelectedVipTitle()}
                onGenerateResponses={(force) => void generateResponses(force)}
                onGenerateReplies={() => void handleGenerateReplies()}
                onPostMessage={handlePostMessage}
                onReplyNameChange={setReplyName}
                onReplyMailChange={setReplyMail}
                onReplyBodyChange={setReplyBody}
                onRateReplyRun={(runId, rating, tags) => void rateReplyRun(runId, rating, tags)}
                onReplyToPost={replyToPost}
                onScrollToPost={scrollToPost}
                onPostNoMouseEnter={handlePostNoMouseEnter}
                onPostNoMouseLeave={handlePostNoMouseLeave}
                onPostIdClick={handleExtractPostId}
                onPostIdMouseEnter={handlePostIdMouseEnter}
                onPostIdMouseLeave={handleMouseLeaveWithDelay}
                onAnchorMouseEnter={handleAnchorMouseEnter}
                onAnchorMouseLeave={handleAnchorMouseLeave}
                isArticlePaneVisible={shouldShowArticlePane}
                onToggleArticlePane={toggleArticlePane}
              />
              {shouldShowArticlePane ? (
                <>
                  <div
                    aria-label="レス一覧と記事本文の境界"
                    aria-orientation="vertical"
                    className="article-pane-splitter"
                    onMouseDown={startArticlePaneResize}
                    role="separator"
                  />
                  <ArticleBodyPane
                    selectedThread={selectedThread}
                    articleBody={articleBody}
                    isLoading={isArticleBodyLoading}
                    onClose={toggleArticlePane}
                  />
                </>
              ) : null}
            </section>
          </section>
        </section>
      </div>

      {isStatisticsOpen ? (
        <StatisticsModal
          statistics={statistics}
          isLoading={isStatisticsLoading}
          onClose={() => setIsStatisticsOpen(false)}
        />
      ) : null}

      {isSettingsOpen ? (
        <SettingsModal
          apiKey={geminiApiKey}
          apiKeyStatus={geminiApiKeyStatus}
          isSaving={isApiKeySaving}
          statusMessage={apiKeyStatusMessage}
          onApiKeyChange={setGeminiApiKey}
          onSave={() => void saveApiKey()}
          onClear={() => void clearApiKey()}
          onClose={() => setIsSettingsOpen(false)}
        />
      ) : null}

      {isResidentPromptsOpen ? (
        <ResidentPromptsModal
          feeds={feedList}
          promptTargetFeedId={promptTargetFeedId}
          promptText={promptText}
          isPromptLoading={isPromptLoading}
          promptStatusMessage={promptStatusMessage}
          promptVersions={promptVersions}
          onPromptTargetFeedIdChange={setPromptTargetFeedId}
          onPromptTextChange={setPromptText}
          onSavePrompt={() => void savePrompt()}
          onClearPrompt={() => void clearPrompt()}
          onReviewPromptVersion={(id, decision) => void reviewPromptVersion(id, decision)}
          onRollbackPromptVersion={() => void rollbackPromptVersion()}
          onClose={() => setIsResidentPromptsOpen(false)}
        />
      ) : null}

      {isAddFeedOpen ? (
        <AddFeedModal
          addFeedTitle={addFeedTitle}
          addFeedUrl={addFeedUrl}
          addFeedError={addFeedError}
          isAddFeedLoading={isAddFeedLoading}
          onTitleChange={setAddFeedTitle}
          onUrlChange={setAddFeedUrl}
          onAddFeed={() => void addFeed()}
          onClose={() => setIsAddFeedOpen(false)}
        />
      ) : null}

      {popupData ? (
        <ReplyPopup
          popupData={popupData}
          onMouseEnter={clearPopupTimeout}
          onMouseLeave={handleMouseLeaveWithDelay}
          onAnchorClick={scrollToPost}
        />
      ) : null}
    </main>
  );
}

function limitLogs(logs: AppLogEntry[]): AppLogEntry[] {
  return logs.length > maxRendererLogs ? logs.slice(logs.length - maxRendererLogs) : logs;
}

type ThreadTabsSession = {
  tabs: OpenThreadTab[];
  activeTabId: string | null;
};

function parseThreadTabsSession(value: string | null): ThreadTabsSession {
  const emptySession: ThreadTabsSession = { tabs: [], activeTabId: null };
  if (!value) {
    return emptySession;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return emptySession;
    }

    const candidate = parsed as { tabs?: unknown; activeTabId?: unknown };
    if (!Array.isArray(candidate.tabs)) {
      return emptySession;
    }

    const seenIds = new Set<string>();
    const tabs: OpenThreadTab[] = [];
    for (const item of candidate.tabs.slice(0, 100)) {
      if (!item || typeof item !== "object") continue;
      const tab = item as Partial<OpenThreadTab>;
      if (
        typeof tab.id !== "string" || !tab.id ||
        typeof tab.feedId !== "string" || !tab.feedId ||
        typeof tab.title !== "string" || !tab.title ||
        seenIds.has(tab.id)
      ) {
        continue;
      }

      seenIds.add(tab.id);
      tabs.push({
        id: tab.id,
        feedId: tab.feedId,
        title: tab.title.slice(0, 160),
        isLocked: tab.isLocked === true
      });
    }

    const activeTabId = typeof candidate.activeTabId === "string" && seenIds.has(candidate.activeTabId)
      ? candidate.activeTabId
      : null;
    return { tabs, activeTabId };
  } catch {
    return emptySession;
  }
}
