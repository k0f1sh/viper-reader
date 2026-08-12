import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { AppLogEntry, FeedFolder, FeedSource, FeedTreePlacement, GeminiApiKeyStatus, ReadingQueueSummary, SmartView, StatisticsSummary, ThreadDetail, ThreadGenerationAttempt, ThreadListItem, ThreadPost, TitleGenerationAttempt } from "../shared/types";
import { AddFeedModal } from "./components/AddFeedModal";
import { ArticleBodyPane } from "./components/ArticleBodyPane";
import { ArticleBrowserPane } from "./components/ArticleBrowserPane";
import { BrowserSettingsModal } from "./components/BrowserSettingsModal";
import { FeedPane } from "./components/FeedPane";
import type { FeedTreeSelection } from "./components/FeedPane";
import { FolderNameModal } from "./components/FolderNameModal";
import { FeedSettingsModal } from "./components/FeedSettingsModal";
import { GenerationFailureModal } from "./components/GenerationFailureModal";
import { MenuBar } from "./components/MenuBar";
import { ModelSettingsModal } from "./components/ModelSettingsModal";
import { ReplyPopup } from "./components/ReplyPopup";
import { ResidentPromptsModal } from "./components/ResidentPromptsModal";
import { SettingsModal } from "./components/SettingsModal";
import { StatisticsModal } from "./components/StatisticsModal";
import { ThreadListPane } from "./components/ThreadListPane";
import { ThreadReaderPane } from "./components/ThreadReaderPane";
import { TitleGenerationStatusModal } from "./components/TitleGenerationStatusModal";
import { useAddFeedForm, useFeedSettingsForm, useFolderForm, useReplyComposer } from "./hooks/useAppForms";
import { usePaneLayout } from "./hooks/usePaneLayout";
import { useThreadSelection } from "./hooks/useThreadSelection";

const threadColumnLabels = ["状態", "スレタイ", "取得元", "元タイトル", "レス", "日時 ▼", "URL"] as const;
const maxRendererLogs = 300;
const maxConcurrentFeedRefreshes = 5;
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
  const [feedFolders, setFeedFolders] = useState<FeedFolder[]>([]);
  const [selectedTreeNode, setSelectedTreeNode] = useState<FeedTreeSelection>(null);
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(() => new Set());
  const [threadList, setThreadList] = useState<ThreadListItem[]>([]);
  const [threadListPage, setThreadListPage] = useState(0);
  const [threadListTotalCount, setThreadListTotalCount] = useState(0);
  const [allUnreadCount, setAllUnreadCount] = useState(0);
  const [selectedFeedId, setSelectedFeedId] = useState("");
  const selectedFeedIdRef = useRef("");
  selectedFeedIdRef.current = selectedFeedId;
  const [generatingThreadIds, setGeneratingThreadIds] = useState<Set<string>>(() => new Set());
  const [threadGenerationProgress, setThreadGenerationProgress] = useState<Map<string, string>>(() => new Map());
  const [completedGenerationThreadIds, setCompletedGenerationThreadIds] = useState<Set<string>>(() => new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [regeneratingTitleThreadId, setRegeneratingTitleThreadId] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [isStatisticsOpen, setIsStatisticsOpen] = useState(false);
  const [isStatisticsLoading, setIsStatisticsLoading] = useState(false);
  const [statistics, setStatistics] = useState<StatisticsSummary | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isBrowserSettingsOpen, setIsBrowserSettingsOpen] = useState(false);
  const [articleBrowserBlockingEnabled, setArticleBrowserBlockingEnabled] = useState(true);
  const [isBrowserSettingsSaving, setIsBrowserSettingsSaving] = useState(false);
  const [browserSettingsStatusMessage, setBrowserSettingsStatusMessage] = useState("");
  const [isModelSettingsOpen, setIsModelSettingsOpen] = useState(false);
  const [isModelSettingsSaving, setIsModelSettingsSaving] = useState(false);
  const [geminiApiKey, setGeminiApiKey] = useState("");
  const [geminiApiKeyStatus, setGeminiApiKeyStatus] = useState<GeminiApiKeyStatus | null>(null);
  const [isApiKeySaving, setIsApiKeySaving] = useState(false);
  const [apiKeyStatusMessage, setApiKeyStatusMessage] = useState("");
  const [isResidentPromptsOpen, setIsResidentPromptsOpen] = useState(false);
  const [promptTargetFeedId, setPromptTargetFeedId] = useState("");
  const [promptText, setPromptText] = useState("");
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [promptStatusMessage, setPromptStatusMessage] = useState("");
  const {
    appShellRef,
    contentPaneRef,
    threadContentRef,
    threadListHeight,
    feedPaneWidth,
    feedTreeHeight,
    articlePaneWidth,
    isArticlePaneVisible,
    threadGridColumns,
    threadListMinWidth,
    startVerticalResize,
    startFeedPaneResize,
    startFeedTreeResize,
    startThreadColumnResize,
    startArticlePaneResize,
    toggleArticlePane
  } = usePaneLayout();
  const [isAddFeedOpen, setIsAddFeedOpen] = useState(false);
  const { form: addFeedForm, update: updateAddFeedForm, reset: resetAddFeedForm } = useAddFeedForm();
  const { form: folderForm, openCreate: openCreateFolderForm, openRename: openRenameFolderForm, update: updateFolderForm, close: closeFolderForm } = useFolderForm();
  const { form: feedSettingsForm, open: openFeedSettingsForm, update: updateFeedSettingsForm, close: closeFeedSettingsForm } = useFeedSettingsForm();
  const { composer: replyComposer, update: updateReplyComposer, setBody: setReplyBody } = useReplyComposer();
  const {
    title: addFeedTitle,
    url: addFeedUrl,
    generateTitleFromSummary: addFeedGenerateTitleFromSummary,
    skipTitleConversion: addFeedSkipTitleConversion,
    error: addFeedError,
    isLoading: isAddFeedLoading
  } = addFeedForm;
  const folderModalMode = folderForm?.mode ?? null;
  const folderModalTargetId = folderForm?.targetId ?? null;
  const folderName = folderForm?.name ?? "";
  const folderError = folderForm?.error ?? "";
  const isFolderSaving = folderForm?.isSaving ?? false;
  const settingsFeed = feedSettingsForm?.feed ?? null;
  const settingsFeedTitle = feedSettingsForm?.title ?? "";
  const settingsGenerateTitleFromSummary = feedSettingsForm?.generateTitleFromSummary ?? false;
  const settingsSkipTitleConversion = feedSettingsForm?.skipTitleConversion ?? false;
  const isFeedSettingsSaving = feedSettingsForm?.isSaving ?? false;
  const feedSettingsError = feedSettingsForm?.error ?? "";
  const {
    name: replyName,
    mail: replyMail,
    body: replyBody,
    error: postError,
    status: postStatus,
    isPosting
  } = replyComposer;

  const replyDraftsRef = useRef<Map<string, string>>(new Map());
  const postingThreadIdRef = useRef<string | null>(null);
  const [popupData, setPopupData] = useState<{
    title: string;
    posts: ThreadPost[];
    style: CSSProperties;
  } | null>(null);
  const [replyModel, setReplyModel] = useState("gemini-3.6-flash");
  const [titleModel, setTitleModel] = useState("gemini-3.5-flash-lite");
  const popupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const replyBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [favoriteThreads, setFavoriteThreads] = useState<ThreadListItem[]>([]);
  const [isFavoriteCollapsed, setIsFavoriteCollapsed] = useState(false);
  const [readMarkerNo, setReadMarkerNo] = useState<number | null>(null);
  const [extractedPostId, setExtractedPostId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [smartView, setSmartView] = useState<SmartView | null>(null);
  const showUnreadOnlyRef = useRef(false);
  const isUnreadOnlyLocked = selectedFeedId === allFeedsId && smartView === null;
  const effectiveShowUnreadOnly =
    smartView === "unread" || (smartView === null && !isUnreadOnlyLocked && showUnreadOnly);
  showUnreadOnlyRef.current = effectiveShowUnreadOnly;
  const smartViewRef = useRef<SmartView | null>(null);
  smartViewRef.current = smartView;
  const threadListRequestIdRef = useRef(0);
  const [queueSummary, setQueueSummary] = useState<ReadingQueueSummary>({
    unreadCount: 0,
    queuedCount: 0,
    generatingCount: 0,
    completedCount: 0,
    reviewedCount: 0
  });
  const [threadViewMode, setThreadViewMode] = useState<"replies" | "browser">("replies");
  const [generationFailureThreadId, setGenerationFailureThreadId] = useState<string | null>(null);
  const [generationAttempts, setGenerationAttempts] = useState<ThreadGenerationAttempt[]>([]);
  const [isGenerationAttemptsLoading, setIsGenerationAttemptsLoading] = useState(false);
  const [isRetryingGeneration, setIsRetryingGeneration] = useState(false);
  const [titleGenerationThreadId, setTitleGenerationThreadId] = useState<string | null>(null);
  const [titleGenerationAttempts, setTitleGenerationAttempts] = useState<TitleGenerationAttempt[]>([]);
  const [isTitleGenerationAttemptsLoading, setIsTitleGenerationAttemptsLoading] = useState(false);
  const {
    selectedThreadId,
    selectedThreadIdRef,
    setSelectedThreadId,
    selectedThread,
    setSelectedThread,
    articleBody,
    isArticleBodyLoading,
    isSelectedThreadGenerating,
    shouldShowArticlePane
  } = useThreadSelection({
    isArticlePaneEnabled: threadViewMode === "replies" && isArticlePaneVisible,
    generatingThreadIds,
    setThreadList,
    onSelectionStarted: (threadId) => {
      setReadMarkerNo(null);
      setExtractedPostId(null);
      replyBodyRef.current?.blur();
      if (!threadId) return;
      setCompletedGenerationThreadIds((currentIds) => {
        if (!currentIds.has(threadId)) return currentIds;
        const nextIds = new Set(currentIds);
        nextIds.delete(threadId);
        return nextIds;
      });
    },
    onThreadRead: () => {
      void reloadFeeds();
      void reloadQueueSummary();
    }
  });

  const selectedFeed = selectedFeedId === allFeedsId
    ? { id: allFeedsId, title: "全体共通", url: "登録済みの全板・記事時刻の新しい順", unreadCount: feedList.reduce((sum, feed) => sum + feed.unreadCount, 0), lastFetchedAt: null, generateTitleFromSummary: false, skipTitleConversion: false, parentFolderId: null, sortOrder: -1 }
    : feedList.find((feed) => feed.id === selectedFeedId) ?? feedList[0];
  const isRegeneratingSelectedTitle = selectedThread ? regeneratingTitleThreadId === selectedThread.id : false;
  const isArticleBrowserSuspended =
    isStatisticsOpen
    || isSettingsOpen
    || isBrowserSettingsOpen
    || isModelSettingsOpen
    || isResidentPromptsOpen
    || isAddFeedOpen
    || folderModalMode !== null
    || settingsFeed !== null
    || generationFailureThreadId !== null
    || titleGenerationThreadId !== null;
  // 未読巡回中は、開いて既読になった行もセッション内に残して一覧の並びを安定させる。
  const visibleThreads = threadList;

  useEffect(() => {
    void reloadFeeds();
    void loadSettings();
    void loadFavoriteThreads();
    void reloadQueueSummary();
  }, []);

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
    if (smartView === "generated") {
      void reloadGeneratedQueue(0);
    } else if (smartView === "reviewed") {
      void reloadReviewedGenerationQueue(0);
    } else {
      void reloadThreads(selectedFeedId, undefined, 0);
    }
  }, [selectedFeedId, showUnreadOnly, smartView]);

  useEffect(() => {
    if (!window.viperReader) return;
    return window.viperReader.onPostStatus((data) => {
      if (
        (data.status === "done" || data.status === "error")
        && data.threadId === postingThreadIdRef.current
      ) {
        postingThreadIdRef.current = null;
        updateReplyComposer({ isPosting: false });
      }
      if (data.threadId !== selectedThreadId) return;
      updateReplyComposer({ status: data.status });
      if (data.status === "done" || data.status === "error") {
        if (data.status === "error") {
          updateReplyComposer({
            error: `${data.errorMessage ?? "AI住民のレス生成に失敗しました。"} 書き込みは保存されています。`
          });
        }
        void window.viperReader?.getThread(data.threadId).then((thread) => {
          if (!thread) return;
          setSelectedThread(thread);
          setThreadList((current) => current.map((item) => item.id === thread.id ? { ...item, ...thread, isRead: true } : item));
        });
      }
    });
  }, [selectedThreadId]);

  useEffect(() => {
    if (!window.viperReader) {
      return;
    }

    return window.viperReader.onThreadGenerationProgress((progress) => {
      setThreadGenerationProgress((current) => {
        const next = new Map(current);
        next.set(progress.threadId, progress.message);
        return next;
      });
    });
  }, []);

  useEffect(() => {
    if (!window.viperReader) {
      return;
    }

    return window.viperReader.onThreadGenerationComplete((status) => {
      setThreadGenerationProgress((current) => {
        const next = new Map(current);
        next.delete(status.threadId);
        return next;
      });
      setGeneratingThreadIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(status.threadId);
        return nextIds;
      });
      const generationStatus = status.status === "error" ? "failed" : "completed";
      setThreadList((currentThreads) =>
        currentThreads.map((thread) =>
          thread.id === status.threadId ? { ...thread, generationStatus } : thread
        )
      );
      setSelectedThread((thread) =>
        thread?.id === status.threadId ? { ...thread, generationStatus } : thread
      );

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
        if (smartView === "generated") void reloadGeneratedQueue(0);
      }
      void reloadQueueSummary();
    });
  }, [selectedThreadId, smartView]);

  async function reloadFeeds() {
    if (!window.viperReader) {
      return;
    }

    const [nextFeeds, nextFolders, nextAllUnreadCount] = await Promise.all([
      window.viperReader.listFeeds(),
      window.viperReader.listFeedFolders(),
      window.viperReader.countUnreadArticles()
    ]);
    setFeedList(nextFeeds);
    setFeedFolders(nextFolders);
    setCollapsedFolderIds((current) => new Set([...current].filter((id) => nextFolders.some((folder) => folder.id === id))));
    setAllUnreadCount(nextAllUnreadCount);
    void reloadQueueSummary();

    setSelectedFeedId((currentFeedId) =>
      currentFeedId === allFeedsId || nextFeeds.some((feed) => feed.id === currentFeedId) ? currentFeedId : allFeedsId
    );
  }

  async function reloadThreads(feedId: string, preferredThreadId?: string, page = threadListPage) {
    if (!window.viperReader) {
      return;
    }

    const requestId = ++threadListRequestIdRef.current;
    const result = await window.viperReader.listThreads(
      feedId === allFeedsId ? null : feedId,
      page,
      showUnreadOnlyRef.current
    );
    if (requestId !== threadListRequestIdRef.current) {
      return;
    }
    setThreadList(result.items);
    setThreadListPage(result.page);
    setThreadListTotalCount(result.totalCount);
    if (preferredThreadId && result.items.some((thread) => thread.id === preferredThreadId)) {
      setSelectedThreadId(preferredThreadId);
    }
  }

  async function reloadGeneratedQueue(page = threadListPage) {
    if (!window.viperReader) return;
    const requestId = ++threadListRequestIdRef.current;
    const result = await window.viperReader.listGeneratedQueue(page);
    if (requestId !== threadListRequestIdRef.current) return;
    setThreadList(result.items);
    setThreadListPage(result.page);
    setThreadListTotalCount(result.totalCount);
  }

  async function reloadReviewedGenerationQueue(page = threadListPage) {
    if (!window.viperReader) return;
    const requestId = ++threadListRequestIdRef.current;
    const result = await window.viperReader.listReviewedGenerationQueue(page);
    if (requestId !== threadListRequestIdRef.current) return;
    setThreadList(result.items);
    setThreadListPage(result.page);
    setThreadListTotalCount(result.totalCount);
  }

  async function reloadQueueSummary() {
    if (!window.viperReader) return;
    setQueueSummary(await window.viperReader.getReadingQueueSummary());
  }

  async function reloadCurrentThreadList(preferredThreadId?: string) {
    if (smartViewRef.current === "generated") {
      await reloadGeneratedQueue(0);
    } else if (smartViewRef.current === "reviewed") {
      await reloadReviewedGenerationQueue(0);
    } else if (selectedFeedIdRef.current) {
      await reloadThreads(selectedFeedIdRef.current, preferredThreadId, 0);
    }
  }

  function changeThreadListPage(nextPage: number) {
    if (!selectedFeedId || nextPage < 0) return;
    if (smartView === "generated") void reloadGeneratedQueue(nextPage);
    else if (smartView === "reviewed") void reloadReviewedGenerationQueue(nextPage);
    else void reloadThreads(selectedFeedId, undefined, nextPage);
  }

  function selectThreadById(threadId: string) {
    const thread = threadList.find((candidate) => candidate.id === threadId);
    if (thread) {
      selectThread(thread, selectedFeedId === allFeedsId ? allFeedsId : undefined);
    }
  }

  function selectThread(thread: ThreadListItem | ThreadDetail, feedSelection?: string) {
    if (smartView === "generated" && selectedThreadId && selectedThreadId !== thread.id) {
      void window.viperReader?.markThreadGenerationReviewed(selectedThreadId).then(reloadQueueSummary);
    }
    if (selectedThreadId !== thread.id) {
      if (selectedThreadId) {
        replyDraftsRef.current.set(selectedThreadId, replyBody);
      }
      setReplyBody(replyDraftsRef.current.get(thread.id) ?? "");
      updateReplyComposer({ error: "", status: "idle" });
      setPopupData(null);
    }
    setSelectedFeedId(feedSelection ?? thread.feedId);
    setSelectedThreadId(thread.id);
  }

  async function markAllThreadsRead() {
    if (!window.viperReader || !selectedFeedId) return;
    if (selectedFeedId === allFeedsId) {
      await window.viperReader.markAllFeedsRead();
    } else {
      await window.viperReader.markFeedRead(selectedFeedId);
    }
    setThreadList((threads) => threads.map((thread) => ({ ...thread, isRead: true })));
    if (effectiveShowUnreadOnly) setThreadListTotalCount(0);
    await reloadFeeds();
    await reloadQueueSummary();
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

      function scrollPosts(direction: -1 | 1) {
        const posts = document.querySelector<HTMLElement>(".posts");
        if (!posts) return;
        const distance = Math.max(80, Math.round(posts.clientHeight * 0.35));
        posts.scrollBy({ top: direction * distance, behavior: "smooth" });
      }

      function generateThreadPosts() {
        if ((selectedThread?.posts.length ?? 0) <= 1) {
          void generateResponses(false);
        } else if (selectedThread && selectedThread.posts.length < 1000) {
          void handleGenerateReplies();
        }
      }

      if (event.key === "Escape" && target === replyBodyRef.current) {
        event.preventDefault();
        target?.blur();
        return;
      }

      if (event.key === "Escape" && extractedPostId) {
        event.preventDefault();
        setExtractedPostId(null);
        return;
      }

      if (document.querySelector("[role='dialog']")) return;

      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;

      if (event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "j" || event.key === "k")) {
        if (!document.querySelector("[role='dialog']")) {
          scrollPosts(event.key === "j" ? 1 : -1);
          event.preventDefault();
        }
        return;
      }

      if (primaryModifier || event.altKey) return;
      const index = visibleThreads.findIndex((thread) => thread.id === selectedThreadId);
      if (event.key === " " && threadViewMode !== "replies") {
        event.preventDefault();
        void window.viperReader?.scrollArticleBrowser(event.shiftKey ? -1 : 1);
      } else if (event.key === "p" || event.key === "n") {
        event.preventDefault();
        if (threadViewMode === "browser") {
          void window.viperReader?.scrollArticleBrowser(event.key === "n" ? 1 : -1);
        } else {
          scrollPosts(event.key === "n" ? 1 : -1);
        }
      } else if (event.key === "j" || event.key === "k") {
        const delta = event.key === "j" ? 1 : -1;
        const nextIndex = index < 0 ? (delta > 0 ? 0 : visibleThreads.length - 1) : index + delta;
        const next = visibleThreads[nextIndex];
        if (next) { event.preventDefault(); selectThread(next, selectedFeedId === allFeedsId ? allFeedsId : undefined); }
      } else if (event.key === "i") {
        const first = visibleThreads[0];
        if (first) {
          event.preventDefault();
          selectThread(first, selectedFeedId === allFeedsId ? allFeedsId : undefined);
        }
      } else if (event.key === "h" || event.key === "l") {
        const navigationTargets = [
          { id: "__unread_queue__", select: () => selectSmartView("unread") },
          { id: "__generated_queue__", select: () => selectSmartView("generated") },
          { id: "__reviewed_queue__", select: () => selectSmartView("reviewed") },
          { id: allFeedsId, select: () => selectFeed(allFeedsId) },
          ...feedList.map((feed) => ({ id: feed.id, select: () => selectFeed(feed.id) }))
        ];
        const currentTargetId =
          smartView === "unread"
            ? "__unread_queue__"
            : smartView === "generated"
              ? "__generated_queue__"
              : smartView === "reviewed"
                ? "__reviewed_queue__"
                : selectedFeedId;
        const currentIndex = navigationTargets.findIndex((targetItem) => targetItem.id === currentTargetId);
        const delta = event.key === "l" ? 1 : -1;
        const nextIndex = currentIndex < 0 ? (delta > 0 ? 0 : navigationTargets.length - 1) : currentIndex + delta;
        const nextTarget = navigationTargets[nextIndex];
        if (nextTarget) {
          event.preventDefault();
          nextTarget.select();
        }
      } else if (event.key === "r" || event.key === "y") {
        event.preventDefault(); void refreshSelectedFeed();
      } else if (event.key === "g" || event.key === "u") {
        event.preventDefault();
        generateThreadPosts();
      } else if (event.key === "w") {
        if (replyBodyRef.current && !replyBodyRef.current.disabled) {
          event.preventDefault();
          replyBodyRef.current.focus();
        }
      } else if (event.key === "b") {
        event.preventDefault(); void toggleFavorite();
      } else if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (event.repeat) return;
        setThreadViewMode((current) => current === "replies" ? "browser" : "replies");
      } else if (event.key === "U") {
        event.preventDefault(); void toggleSelectedThreadRead();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [feedList, visibleThreads, selectedThreadId, selectedThread, selectedFeedId, smartView, isRefreshing, isSelectedThreadGenerating, isPosting, extractedPostId, threadViewMode]);

  async function loadSettings() {
    if (!window.viperReader) {
      return;
    }

    try {
      const [model, savedTitleModel, savedArticleBrowserBlockingEnabled, savedCollapsedFolders] = await Promise.all([
        window.viperReader.getUserSetting("replyModel"),
        window.viperReader.getUserSetting("titleModel"),
        window.viperReader.getUserSetting("articleBrowserBlockingEnabled"),
        window.viperReader.getUserSetting("collapsedFeedFolderIds")
      ]);

      if (model) {
        setReplyModel(model);
      }
      if (savedTitleModel) {
        setTitleModel(savedTitleModel);
      }
      setArticleBrowserBlockingEnabled(savedArticleBrowserBlockingEnabled !== "false");
      if (savedCollapsedFolders) {
        const parsed = JSON.parse(savedCollapsedFolders) as unknown;
        if (Array.isArray(parsed)) setCollapsedFolderIds(new Set(parsed.filter((id): id is string => typeof id === "string")));
      }

    } catch (err) {
      console.error("ユーザー設定の読込に失敗しました:", err);
    }
  }

  async function saveModelSettings(models: { titleModel: string; replyModel: string }) {
    if (!window.viperReader) return;
    setIsModelSettingsSaving(true);
    try {
      await Promise.all([
        window.viperReader.saveUserSetting("titleModel", models.titleModel),
        window.viperReader.saveUserSetting("replyModel", models.replyModel)
      ]);
      setTitleModel(models.titleModel);
      setReplyModel(models.replyModel);
      setIsModelSettingsOpen(false);
    } catch (err) {
      console.error("モデル設定の保存に失敗しました:", err);
    } finally {
      setIsModelSettingsSaving(false);
    }
  }

  async function changeArticleBrowserBlockingEnabled(enabled: boolean) {
    if (!window.viperReader) {
      return;
    }

    setIsBrowserSettingsSaving(true);
    setBrowserSettingsStatusMessage("");
    try {
      await window.viperReader.setArticleBrowserGlobalBlockingEnabled(enabled);
      setArticleBrowserBlockingEnabled(enabled);
      setBrowserSettingsStatusMessage(enabled
        ? "広告・追跡ブロックを有効にしました。"
        : "広告・追跡ブロックを無効にしました。");
    } catch (err) {
      setBrowserSettingsStatusMessage(err instanceof Error ? err.message : "ブラウザ設定の保存に失敗しました。");
    } finally {
      setIsBrowserSettingsSaving(false);
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
    reviewCurrentGeneratedThread();
    setSmartView(null);
    setSelectedFeedId(feedId);
    setSelectedTreeNode(feedId === allFeedsId ? null : { type: "feed", id: feedId });
    setRefreshMessage("");
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

  function selectSmartView(view: SmartView) {
    function activateView() {
      setSmartView(view);
      setSelectedFeedId(allFeedsId);
      setSelectedTreeNode(null);
      setSelectedThreadId(undefined);
      setSelectedThread(null);
      setRefreshMessage("");
    }

    if (view !== smartView && smartView === "generated" && selectedThreadId && window.viperReader) {
      void window.viperReader.markThreadGenerationReviewed(selectedThreadId)
        .then(reloadQueueSummary)
        .catch(() => undefined)
        .finally(activateView);
      return;
    }
    activateView();
  }

  function reviewCurrentGeneratedThread() {
    if (smartView !== "generated" || !selectedThreadId || !window.viperReader) return;
    void window.viperReader.markThreadGenerationReviewed(selectedThreadId).then(reloadQueueSummary);
  }

  async function saveFeedTreeLayout(placements: FeedTreePlacement[]) {
    if (!window.viperReader) return;
    try {
      await window.viperReader.saveFeedTreeLayout(placements);
      await reloadFeeds();
    } catch {
      alert("板一覧の並び替えに失敗しました。");
    }
  }

  async function addFeed() {
    if (!window.viperReader || !addFeedTitle.trim() || !addFeedUrl.trim()) {
      return;
    }

    updateAddFeedForm({ isLoading: true, error: "" });
    try {
      const newFeed = await window.viperReader.addFeedSource(
        addFeedTitle.trim(),
        addFeedUrl.trim(),
        addFeedGenerateTitleFromSummary,
        addFeedSkipTitleConversion,
        selectedTreeNode?.type === "folder"
          ? selectedTreeNode.id
          : selectedTreeNode?.type === "feed"
            ? feedList.find((feed) => feed.id === selectedTreeNode.id)?.parentFolderId ?? null
            : null
      );
      await reloadFeeds();
      setSelectedFeedId(newFeed.id);
      setSelectedTreeNode({ type: "feed", id: newFeed.id });
      setIsAddFeedOpen(false);
      resetAddFeedForm();
    } catch (err) {
      updateAddFeedForm({ error: err instanceof Error ? err.message : "追加に失敗しました。" });
    } finally {
      updateAddFeedForm({ isLoading: false });
    }
  }

  function openCreateFolder() {
    openCreateFolderForm();
  }

  function openRenameFolder(folder: FeedFolder) {
    openRenameFolderForm(folder);
  }

  async function saveFolder() {
    if (!window.viperReader || !folderModalMode || !folderName.trim()) return;
    updateFolderForm({ isSaving: true, error: "" });
    try {
      if (folderModalMode === "rename" && folderModalTargetId) {
        await window.viperReader.renameFeedFolder(folderModalTargetId, folderName);
      } else {
        const selectedFeed = selectedTreeNode?.type === "feed" ? feedList.find((feed) => feed.id === selectedTreeNode.id) : null;
        const parentFolderId = selectedTreeNode?.type === "folder" ? selectedTreeNode.id : selectedFeed?.parentFolderId ?? null;
        const folder = await window.viperReader.createFeedFolder(folderName, parentFolderId);
        if (selectedFeed) {
          const placements = [
            ...feedList.map((feed) => ({ type: "feed" as const, id: feed.id, parentFolderId: feed.parentFolderId, sortOrder: feed.sortOrder })),
            ...feedFolders.map((item) => ({ type: "folder" as const, id: item.id, parentFolderId: item.parentFolderId, sortOrder: item.sortOrder })),
            { type: "folder" as const, id: folder.id, parentFolderId: folder.parentFolderId, sortOrder: folder.sortOrder }
          ].sort((a, b) => (a.parentFolderId ?? "").localeCompare(b.parentFolderId ?? "") || a.sortOrder - b.sortOrder);
          const createdIndex = placements.findIndex((item) => item.type === "folder" && item.id === folder.id);
          const [created] = placements.splice(createdIndex, 1);
          const selectedIndex = placements.findIndex((item) => item.type === "feed" && item.id === selectedFeed.id);
          placements.splice(selectedIndex + 1, 0, created);
          await window.viperReader.saveFeedTreeLayout(placements.map(({ type, id, parentFolderId: parent }) => ({ type, id, parentFolderId: parent })));
        }
        if (parentFolderId && collapsedFolderIds.has(parentFolderId)) toggleFolder(parentFolderId);
        setSelectedTreeNode({ type: "folder", id: folder.id });
      }
      await reloadFeeds();
      closeFolderForm();
    } catch (error) {
      updateFolderForm({ error: error instanceof Error ? error.message : "フォルダを保存できませんでした。" });
    } finally {
      updateFolderForm({ isSaving: false });
    }
  }

  async function deleteSelectedTreeNode() {
    if (!selectedTreeNode || !window.viperReader) return;
    if (selectedTreeNode.type === "feed") {
      await deleteFeedById(selectedTreeNode.id);
      return;
    }
    const folder = feedFolders.find((candidate) => candidate.id === selectedTreeNode.id);
    if (!folder || !confirm(`フォルダ「${folder.name}」を削除しますか？`)) return;
    try {
      await window.viperReader.deleteFeedFolder(folder.id);
      setSelectedTreeNode(null);
      await reloadFeeds();
    } catch (error) {
      alert(error instanceof Error ? error.message : "フォルダを削除できませんでした。");
    }
  }

  async function deleteFeedById(feedId: string) {
    if (!window.viperReader) return;
    const feedToDelete = feedList.find((feed) => feed.id === feedId);
    if (!feedToDelete || !confirm(`板「${feedToDelete.title}」を削除しますか？\n（この板に含まれるすべての記事やキャッシュも消去されます）`)) return;
    try {
      await window.viperReader.deleteFeedSource(feedId);
      if (selectedThread?.feedId === feedId) { setSelectedThreadId(undefined); setSelectedThread(null); }
      setSelectedTreeNode(null);
      await reloadFeeds();
    } catch { alert("削除に失敗しました。"); }
  }

  function openFeedSettings(feed: FeedSource) {
    openFeedSettingsForm(feed);
  }

  async function saveFeedSettings() {
    if (!window.viperReader || !settingsFeed) return;
    updateFeedSettingsForm({ isSaving: true, error: "" });
    try {
      const updated = await window.viperReader.updateFeedSettings(
        settingsFeed.id,
        settingsFeedTitle,
        settingsGenerateTitleFromSummary,
        settingsSkipTitleConversion
      );
      setFeedList((current) => current.map((feed) => feed.id === updated.id ? updated : feed));
      await reloadCurrentThreadList(selectedThreadIdRef.current);
      if (selectedThreadIdRef.current) {
        setSelectedThread(await window.viperReader.getThread(selectedThreadIdRef.current));
      }
      closeFeedSettingsForm();
    } catch (err) {
      updateFeedSettingsForm({ error: err instanceof Error ? err.message : "設定の保存に失敗しました。" });
    } finally {
      updateFeedSettingsForm({ isSaving: false });
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
    void window.viperReader.getFeedResidentPrompt(promptTargetFeedId)
      .then((res) => {
        setPromptText(res?.prompt ?? "");
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
      await reloadFeeds();
    } catch (err) {
      setPromptStatusMessage(err instanceof Error ? `クリア失敗: ${err.message}` : "クリア失敗");
    } finally {
      setIsPromptLoading(false);
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
      await reloadCurrentThreadList(preferredThreadId);
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
    const feedById = new Map(feedsToRefresh.map((feed) => [feed.id, feed]));
    let nextFeedIndex = 0;
    let completedFeedCount = 0;

    setIsRefreshing(true);
    setRefreshMessage(`全板更新を開始...（0/${feedsToRefresh.length}板・最大${maxConcurrentFeedRefreshes}並列）`);
    const unsubscribeProgress = window.viperReader.onRefreshProgress((progress) => {
      const feed = feedById.get(progress.feedId);
      if (feed) {
        setRefreshMessage(`全板更新 完了${completedFeedCount}/${feedsToRefresh.length}板「${feed.title}」: ${progress.message}`);
      }
    });

    try {
      async function refreshNextFeed(): Promise<void> {
        while (nextFeedIndex < feedsToRefresh.length) {
          const feed = feedsToRefresh[nextFeedIndex];
          nextFeedIndex += 1;
          setRefreshMessage(`全板更新 完了${completedFeedCount}/${feedsToRefresh.length}板「${feed.title}」: RSS取得中...`);
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
            setRefreshMessage(`全板更新 ${completedFeedCount}/${feedsToRefresh.length}板完了`);
          }
        }
      }

      const workerCount = Math.min(maxConcurrentFeedRefreshes, feedsToRefresh.length);
      await Promise.all(Array.from({ length: workerCount }, () => refreshNextFeed()));

      await reloadFeeds();
      await reloadCurrentThreadList(selectedThreadIdRef.current);
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
    setThreadGenerationProgress((current) => {
      const next = new Map(current);
      next.set(selectedThread.id, "レス生成を準備中...");
      return next;
    });

    try {
      await window.viperReader.generateThreadResponses(selectedThread.id, force);
      await reloadQueueSummary();
    } catch (err) {
      setGeneratingThreadIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(selectedThread.id);
        return nextIds;
      });
      setThreadGenerationProgress((current) => {
        const next = new Map(current);
        next.delete(selectedThread.id);
        return next;
      });
    }
  }

  async function showGenerationFailure(threadId: string) {
    if (!window.viperReader) return;
    setGenerationFailureThreadId(threadId);
    setGenerationAttempts([]);
    setIsGenerationAttemptsLoading(true);
    try {
      const attempts = await window.viperReader.listThreadGenerationAttempts(threadId);
      setGenerationAttempts(attempts);
    } finally {
      setIsGenerationAttemptsLoading(false);
    }
  }

  async function retryFailedGeneration() {
    if (!window.viperReader || !generationFailureThreadId || isRetryingGeneration) return;
    const threadId = generationFailureThreadId;
    setIsRetryingGeneration(true);
    setGeneratingThreadIds((currentIds) => new Set(currentIds).add(threadId));
    setThreadGenerationProgress((current) => {
      const next = new Map(current);
      next.set(threadId, "レス生成を準備中...");
      return next;
    });
    setThreadList((threads) =>
      threads.map((thread) => thread.id === threadId ? { ...thread, generationStatus: "queued" } : thread)
    );
    try {
      await window.viperReader.generateThreadResponses(threadId, true);
      setGenerationFailureThreadId(null);
      await reloadQueueSummary();
    } finally {
      setIsRetryingGeneration(false);
    }
  }

  async function showTitleGenerationStatus(threadId: string) {
    if (!window.viperReader) return;
    setTitleGenerationThreadId(threadId);
    setTitleGenerationAttempts([]);
    setIsTitleGenerationAttemptsLoading(true);
    try {
      setTitleGenerationAttempts(await window.viperReader.listTitleGenerationAttempts(threadId));
    } finally {
      setIsTitleGenerationAttemptsLoading(false);
    }
  }

  async function regenerateSelectedThreadTitle() {
    if (!selectedThread || !window.viperReader || regeneratingTitleThreadId) {
      return;
    }

    const threadId = selectedThread.id;
    setRegeneratingTitleThreadId(threadId);
    updateReplyComposer({ error: "" });

    try {
      const result = await window.viperReader.regenerateThreadTitle(threadId);
      if (result) {
        if (selectedThreadIdRef.current === threadId) {
          setSelectedThread(result);
        }
        setThreadList((currentThreads) =>
          currentThreads.map((currentThread) =>
            currentThread.id === result.id ? { ...currentThread, ...result, isRead: true } : currentThread
          )
        );
      }
    } catch (err) {
      if (selectedThreadIdRef.current === threadId) {
        updateReplyComposer({ error: err instanceof Error ? err.message : "スレタイ再生成に失敗しました。" });
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

    updateReplyComposer({ isPosting: true, error: "", status: "idle" });
    postingThreadIdRef.current = threadId;

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
        updateReplyComposer({ error: err instanceof Error ? err.message : "書き込みに失敗しました。" });
      }
      if (postingThreadIdRef.current === threadId) {
        postingThreadIdRef.current = null;
        updateReplyComposer({ isPosting: false });
      }
      if (selectedThreadIdRef.current === threadId) {
        updateReplyComposer({ status: "idle" });
      }
    }
  }

  async function handleGenerateReplies() {
    if (!selectedThread || !window.viperReader || isPosting) return;

    const threadId = selectedThread.id;
    // 再読み込み前の最後のレス番号を記録してセパレーターに使う
    const markerNo = selectedThread.posts.reduce((max, p) => Math.max(max, p.no), 0);

    updateReplyComposer({ isPosting: true, error: "" });
    postingThreadIdRef.current = threadId;

    const unsubscribePostStatus = window.viperReader.onPostStatus((data) => {
      if (data.threadId === threadId && selectedThreadIdRef.current === threadId) {
        updateReplyComposer({ status: data.status });
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
        updateReplyComposer({ error: err instanceof Error ? err.message : "レス生成に失敗しました。" });
      }
    } finally {
      unsubscribePostStatus();
      if (postingThreadIdRef.current === threadId) {
        postingThreadIdRef.current = null;
        updateReplyComposer({ isPosting: false });
      }
      updateReplyComposer({ status: "idle" });
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
    selectThread(thread);
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

  return (
    <main className="app-frame">
      <MenuBar
        onOpenSettings={() => void openSettings()}
        onOpenBrowserSettings={() => {
          setBrowserSettingsStatusMessage("");
          setIsBrowserSettingsOpen(true);
        }}
        onOpenModelSettings={() => setIsModelSettingsOpen(true)}
        onOpenStatistics={openStatistics}
        onOpenResidentPrompts={openResidentPrompts}
      />

      <div
        className="app-shell"
        ref={appShellRef}
        style={{ "--feed-pane-width": `${feedPaneWidth}px` } as CSSProperties}
      >
        <FeedPane
          feeds={feedList}
          folders={feedFolders}
          collapsedFolderIds={collapsedFolderIds}
          selectedTreeNode={selectedTreeNode}
          favoriteThreads={favoriteThreads}
          logs={logs}
          selectedFeedId={selectedFeedId}
          selectedThreadId={selectedThreadId}
          isFavoriteCollapsed={isFavoriteCollapsed}
          onSelectFeed={selectFeed}
          onSelectFolder={selectFolder}
          onToggleFolder={toggleFolder}
          onRefreshFeed={(feedId) => void refreshFeed(feedId)}
          onAddFeed={() => setIsAddFeedOpen(true)}
          onAddFolder={openCreateFolder}
          onDeleteSelectedNode={() => void deleteSelectedTreeNode()}
          onOpenFeedSettings={openFeedSettings}
          onRenameFolder={openRenameFolder}
          onSaveTreeLayout={(placements) => void saveFeedTreeLayout(placements)}
          onToggleFavoriteCollapsed={() => setIsFavoriteCollapsed((current) => !current)}
          onSelectFavoriteThread={handleSelectFavoriteThread}
          allFeedsId={allFeedsId}
          allUnreadCount={allUnreadCount}
          queueSummary={queueSummary}
          activeSmartView={smartView}
          onSelectSmartView={selectSmartView}
          feedTreeHeight={feedTreeHeight}
          onStartFeedTreeResize={startFeedTreeResize}
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
            selectedThreadId={selectedThreadId}
            threads={visibleThreads}
            generatingThreadIds={generatingThreadIds}
            completedThreadIds={completedGenerationThreadIds}
            isRefreshing={isRefreshing}
            refreshMessage={refreshMessage}
            showUnreadOnly={effectiveShowUnreadOnly}
            isUnreadOnlyLocked={isUnreadOnlyLocked}
            threadColumnLabels={threadColumnLabels}
            threadGridColumns={threadGridColumns}
            threadListMinWidth={threadListMinWidth}
            onRefresh={() => void refreshSelectedFeed()}
            onSelectThread={selectThreadById}
            onShowGenerationFailure={(threadId) => void showGenerationFailure(threadId)}
            onShowTitleGenerationStatus={(threadId) => void showTitleGenerationStatus(threadId)}
            onToggleUnreadOnly={() => {
              if (!isUnreadOnlyLocked) setShowUnreadOnly((current) => !current);
            }}
            onMarkAllRead={() => void markAllThreadsRead()}
            onStartColumnResize={startThreadColumnResize}
            canRefresh={selectedFeedId !== allFeedsId || feedList.length > 0}
            refreshLabel={selectedFeedId === allFeedsId ? "全板更新" : "更新"}
            page={threadListPage}
            pageSize={100}
            totalCount={threadListTotalCount}
            onPreviousPage={() => changeThreadListPage(threadListPage - 1)}
            onNextPage={() => changeThreadListPage(threadListPage + 1)}
            smartView={smartView}
            queueSummary={queueSummary}
            onOpenGeneratedQueue={() => selectSmartView("generated")}
          />

          <div
            aria-label="スレタイ一覧とスレ本文の境界"
            className="pane-splitter"
            onMouseDown={startVerticalResize}
            role="separator"
          />

          <section className="thread-workspace">
            {threadViewMode === "browser" ? (
              <ArticleBrowserPane
                selectedThread={selectedThread}
                isActive
                isSuspended={isArticleBrowserSuspended}
                onShowReplies={() => setThreadViewMode("replies")}
              />
            ) : (
              <section
                className={`thread-content ${shouldShowArticlePane ? "has-article-pane" : ""}`}
                ref={threadContentRef}
                style={{ "--article-pane-width": `${articlePaneWidth}px` } as CSSProperties}
              >
                <ThreadReaderPane
                  selectedThread={selectedThread}
                  isSelectedThreadGenerating={isSelectedThreadGenerating}
                  generationProgressMessage={selectedThread ? threadGenerationProgress.get(selectedThread.id) ?? "" : ""}
                  isRegeneratingTitle={isRegeneratingSelectedTitle}
                  skipTitleConversion={feedList.find((feed) => feed.id === selectedThread?.feedId)?.skipTitleConversion ?? false}
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
                  onRegenerateThreadTitle={() => void regenerateSelectedThreadTitle()}
                  onGenerateResponses={(force) => void generateResponses(force)}
                  onGenerateReplies={() => void handleGenerateReplies()}
                  onPostMessage={handlePostMessage}
                  onReplyNameChange={(name) => updateReplyComposer({ name })}
                  onReplyMailChange={(mail) => updateReplyComposer({ mail })}
                  onReplyBodyChange={setReplyBody}
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
                  onShowArticleBrowser={() => setThreadViewMode("browser")}
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
            )}
          </section>
        </section>
      </div>

      <footer className="shortcut-bar" aria-label="キーボードショートカット">
        <span><kbd>P</kbd>/<kbd>N</kbd> レス／元記事スクロール</span>
        <span><kbd>Ctrl</kbd>+<kbd>J</kbd>/<kbd>K</kbd> レススクロール</span>
        <span><kbd>J</kbd>/<kbd>K</kbd> スレ移動</span>
        <span><kbd>I</kbd> 先頭スレ</span>
        <span><kbd>O</kbd> レス／元記事</span>
        <span><kbd>Space</kbd>/<kbd>Shift</kbd>+<kbd>Space</kbd> 元記事スクロール</span>
        <span><kbd>H</kbd>/<kbd>L</kbd> 板移動</span>
        <span><kbd>G</kbd>/<kbd>U</kbd> AIレス</span>
        <span><kbd>W</kbd> 書き込み</span>
        <span><kbd>R</kbd>/<kbd>Y</kbd> 更新</span>
        <span><kbd>B</kbd> お気に入り</span>
        <span><kbd>Shift</kbd>+<kbd>U</kbd> 既読切替</span>
      </footer>

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

      {isBrowserSettingsOpen ? (
        <BrowserSettingsModal
          blockingEnabled={articleBrowserBlockingEnabled}
          isSaving={isBrowserSettingsSaving}
          statusMessage={browserSettingsStatusMessage}
          onBlockingEnabledChange={(enabled) => void changeArticleBrowserBlockingEnabled(enabled)}
          onClose={() => setIsBrowserSettingsOpen(false)}
        />
      ) : null}

      {isModelSettingsOpen ? (
        <ModelSettingsModal
          titleModel={titleModel}
          replyModel={replyModel}
          isSaving={isModelSettingsSaving}
          onSave={(models) => void saveModelSettings(models)}
          onClose={() => setIsModelSettingsOpen(false)}
        />
      ) : null}

      {isResidentPromptsOpen ? (
        <ResidentPromptsModal
          feeds={feedList}
          promptTargetFeedId={promptTargetFeedId}
          promptText={promptText}
          isPromptLoading={isPromptLoading}
          promptStatusMessage={promptStatusMessage}
          onPromptTargetFeedIdChange={setPromptTargetFeedId}
          onPromptTextChange={setPromptText}
          onSavePrompt={() => void savePrompt()}
          onClearPrompt={() => void clearPrompt()}
          onClose={() => setIsResidentPromptsOpen(false)}
        />
      ) : null}

      {isAddFeedOpen ? (
        <AddFeedModal
          addFeedTitle={addFeedTitle}
          addFeedUrl={addFeedUrl}
          addFeedError={addFeedError}
          generateTitleFromSummary={addFeedGenerateTitleFromSummary}
          skipTitleConversion={addFeedSkipTitleConversion}
          isAddFeedLoading={isAddFeedLoading}
          onTitleChange={(title) => updateAddFeedForm({ title })}
          onUrlChange={(url) => updateAddFeedForm({ url })}
          onGenerateTitleFromSummaryChange={(generateTitleFromSummary) => updateAddFeedForm({ generateTitleFromSummary })}
          onSkipTitleConversionChange={(skipTitleConversion) => updateAddFeedForm({ skipTitleConversion })}
          onAddFeed={() => void addFeed()}
          onClose={() => setIsAddFeedOpen(false)}
        />
      ) : null}

      {folderModalMode ? (
        <FolderNameModal
          mode={folderModalMode}
          name={folderName}
          error={folderError}
          isSaving={isFolderSaving}
          onNameChange={(name) => updateFolderForm({ name })}
          onSave={() => void saveFolder()}
          onClose={closeFolderForm}
        />
      ) : null}

      {settingsFeed ? (
        <FeedSettingsModal
          feed={settingsFeed}
          title={settingsFeedTitle}
          generateTitleFromSummary={settingsGenerateTitleFromSummary}
          skipTitleConversion={settingsSkipTitleConversion}
          isSaving={isFeedSettingsSaving}
          error={feedSettingsError}
          onTitleChange={(title) => updateFeedSettingsForm({ title })}
          onGenerateTitleFromSummaryChange={(generateTitleFromSummary) => updateFeedSettingsForm({ generateTitleFromSummary })}
          onSkipTitleConversionChange={(skipTitleConversion) => updateFeedSettingsForm({ skipTitleConversion })}
          onSave={() => void saveFeedSettings()}
          onClose={closeFeedSettingsForm}
        />
      ) : null}

      {generationFailureThreadId ? (
        <GenerationFailureModal
          thread={threadList.find((thread) => thread.id === generationFailureThreadId)}
          attempts={generationAttempts}
          isLoading={isGenerationAttemptsLoading}
          isRetrying={isRetryingGeneration}
          onRetry={() => void retryFailedGeneration()}
          onClose={() => setGenerationFailureThreadId(null)}
        />
      ) : null}

      {titleGenerationThreadId ? (
        <TitleGenerationStatusModal
          thread={threadList.find((thread) => thread.id === titleGenerationThreadId)}
          attempts={titleGenerationAttempts}
          isLoading={isTitleGenerationAttemptsLoading}
          onClose={() => setTitleGenerationThreadId(null)}
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
