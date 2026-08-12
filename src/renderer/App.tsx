import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { AppLogEntry, FeedFolder, FeedSource, GeminiApiKeyStatus, SmartView, StatisticsSummary, ThreadDetail, ThreadListItem, ThreadPost, TitleGenerationAttempt } from "../shared/types";
import { AppDialogs } from "./components/AppDialogs";
import { ArticleBodyPane } from "./components/ArticleBodyPane";
import { ArticleBrowserPane } from "./components/ArticleBrowserPane";
import { FeedPane } from "./components/FeedPane";
import { MenuBar } from "./components/MenuBar";
import { ThreadListPane } from "./components/ThreadListPane";
import { ThreadReaderPane } from "./components/ThreadReaderPane";
import { useAddFeedForm, useFeedSettingsForm, useFolderForm } from "./hooks/useAppForms";
import { usePaneLayout } from "./hooks/usePaneLayout";
import { useThreadSelection } from "./hooks/useThreadSelection";
import { useThreadGeneration } from "./hooks/useThreadGeneration";
import { allFeedsId, useFeedTree } from "./hooks/useFeedTree";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useThreadList } from "./hooks/useThreadList";
import { useFeedRefresh } from "./hooks/useFeedRefresh";
import { usePosting } from "./hooks/usePosting";

const threadColumnLabels = ["状態", "スレタイ", "取得元", "元タイトル", "レス", "日時 ▼", "URL"] as const;
const maxRendererLogs = 300;

export function App() {
  const {
    feeds: feedList,
    setFeeds: setFeedList,
    folders: feedFolders,
    selectedTreeNode,
    setSelectedTreeNode,
    collapsedFolderIds,
    selectedFeedId,
    selectedFeedIdRef,
    setSelectedFeedId,
    selectedFeed,
    allUnreadCount,
    reload: reloadFeeds,
    selectFeed: selectFeedNode,
    selectFolder,
    toggleFolder,
    saveLayout: saveFeedTreeLayout,
    deleteSelected: deleteSelectedTreeNode,
    saveFolder: saveFeedFolder
  } = useFeedTree({
    onReload: () => void reloadQueueSummary(),
    onFeedDeleted: (feedId) => {
      if (selectedThread?.feedId === feedId) {
        setSelectedThreadId(undefined);
        setSelectedThread(null);
      }
    }
  });
  const {
    threads: threadList,
    setThreads: setThreadList,
    page: threadListPage,
    totalCount: threadListTotalCount,
    showUnreadOnly,
    setShowUnreadOnly,
    smartView,
    smartViewRef,
    setSmartView,
    queueSummary,
    isUnreadOnlyLocked,
    effectiveShowUnreadOnly,
    reloadThreads,
    reloadGenerated: reloadGeneratedQueue,
    reloadReviewed: reloadReviewedGenerationQueue,
    reloadSummary: reloadQueueSummary,
    reloadCurrent: reloadCurrentThreadList,
    changePage: changeThreadListPage,
    markAllRead: markAllThreadsRead,
    toggleRead: toggleThreadRead
  } = useThreadList({
    selectedFeedId,
    selectedFeedIdRef,
    onClearSelection: () => {
      setSelectedThreadId(undefined);
      setSelectedThread(null);
    },
    onSelectPreferredThread: (threadId) => setSelectedThreadId(threadId),
    onReloadFeeds: reloadFeeds,
    onSelectedThreadReadChange: (threadId, isRead) => {
      setSelectedThread((thread) => thread?.id === threadId ? { ...thread, isRead } : thread);
    }
  });
  const [regeneratingTitleThreadId, setRegeneratingTitleThreadId] = useState<string | null>(null);
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
  const [threadViewMode, setThreadViewMode] = useState<"replies" | "browser">("replies");
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
    shouldShowArticlePane
  } = useThreadSelection({
    isArticlePaneEnabled: threadViewMode === "replies" && isArticlePaneVisible,
    setThreadList,
    onSelectionStarted: (threadId) => {
      setReadMarkerNo(null);
      setExtractedPostId(null);
      replyBodyRef.current?.blur();
      if (!threadId) return;
      clearCompletedGeneration(threadId);
    },
    onThreadRead: () => {
      void reloadFeeds();
      void reloadQueueSummary();
    }
  });
  const {
    composer: replyComposer,
    update: updateReplyComposer,
    setBody: setReplyBody,
    switchThread: switchReplyThread,
    replyToPost,
    postMessage: handlePostMessage,
    generateReplies: handleGenerateReplies
  } = usePosting({
    selectedThreadId,
    selectedThreadIdRef,
    selectedThread,
    setSelectedThread,
    setThreadList,
    setReadMarkerNo,
    replyBodyRef,
    reloadFeeds
  });
  const {
    name: replyName,
    mail: replyMail,
    body: replyBody,
    error: postError,
    status: postStatus,
    isPosting
  } = replyComposer;
  const {
    generatingThreadIds,
    progressByThreadId: threadGenerationProgress,
    completedThreadIds: completedGenerationThreadIds,
    failureThreadId: generationFailureThreadId,
    attempts: generationAttempts,
    isAttemptsLoading: isGenerationAttemptsLoading,
    isRetrying: isRetryingGeneration,
    generate: generateThreadResponses,
    showFailure: showGenerationFailure,
    retryFailure: retryFailedGeneration,
    closeFailure: closeGenerationFailure,
    clearCompleted: clearCompletedGeneration
  } = useThreadGeneration({
    selectedThreadIdRef,
    smartViewRef,
    setThreadList,
    setSelectedThread,
    reloadGeneratedQueue: () => void reloadGeneratedQueue(0),
    reloadQueueSummary
  });
  const {
    isRefreshing,
    message: refreshMessage,
    clearMessage: clearRefreshMessage,
    refreshFeed,
    refreshSelectedFeed
  } = useFeedRefresh({
    feeds: feedList,
    threads: threadList,
    selectedFeedId,
    selectedThreadIdRef,
    reloadFeeds,
    reloadCurrentThreadList
  });

  const isRegeneratingSelectedTitle = selectedThread ? regeneratingTitleThreadId === selectedThread.id : false;
  const isSelectedThreadGenerating = selectedThread ? generatingThreadIds.has(selectedThread.id) : false;
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

  useKeyboardShortcuts({
    feeds: feedList,
    threads: visibleThreads,
    selectedThreadId,
    selectedThread,
    selectedFeedId,
    smartView,
    threadViewMode,
    extractedPostId,
    replyBodyRef,
    onSelectThread: selectThread,
    onSelectFeed: selectFeed,
    onSelectSmartView: selectSmartView,
    onRefresh: () => void refreshSelectedFeed(),
    onGenerateResponses: () => void generateResponses(false),
    onGenerateReplies: () => void handleGenerateReplies(),
    onToggleFavorite: () => void toggleFavorite(),
    onToggleThreadRead: () => void toggleSelectedThreadRead(),
    onToggleThreadView: () => setThreadViewMode((current) => current === "replies" ? "browser" : "replies"),
    onClearExtractedPost: () => setExtractedPostId(null)
  });

  useEffect(() => {
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
      switchReplyThread(selectedThreadId, thread.id);
      setPopupData(null);
    }
    setSelectedFeedId(feedSelection ?? thread.feedId);
    setSelectedThreadId(thread.id);
  }

  async function toggleSelectedThreadRead() {
    if (selectedThreadId) await toggleThreadRead(selectedThreadId);
  }

  async function loadSettings() {
    if (!window.viperReader) {
      return;
    }

    try {
      const [model, savedTitleModel, savedArticleBrowserBlockingEnabled] = await Promise.all([
        window.viperReader.getUserSetting("replyModel"),
        window.viperReader.getUserSetting("titleModel"),
        window.viperReader.getUserSetting("articleBrowserBlockingEnabled")
      ]);

      if (model) {
        setReplyModel(model);
      }
      if (savedTitleModel) {
        setTitleModel(savedTitleModel);
      }
      setArticleBrowserBlockingEnabled(savedArticleBrowserBlockingEnabled !== "false");

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
    selectFeedNode(feedId);
    clearRefreshMessage();
  }

  function selectSmartView(view: SmartView) {
    function activateView() {
      setSmartView(view);
      setSelectedFeedId(allFeedsId);
      setSelectedTreeNode(null);
      setSelectedThreadId(undefined);
      setSelectedThread(null);
      clearRefreshMessage();
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
      await saveFeedFolder(folderModalMode, folderModalTargetId, folderName);
      closeFolderForm();
    } catch (error) {
      updateFolderForm({ error: error instanceof Error ? error.message : "フォルダを保存できませんでした。" });
    } finally {
      updateFolderForm({ isSaving: false });
    }
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

  async function generateResponses(force = false) {
    if (selectedThread) await generateThreadResponses(selectedThread, force);
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

      <AppDialogs
        statistics={isStatisticsOpen ? { statistics, isLoading: isStatisticsLoading, onClose: () => setIsStatisticsOpen(false) } : null}
        settings={isSettingsOpen ? { apiKey: geminiApiKey, apiKeyStatus: geminiApiKeyStatus, isSaving: isApiKeySaving, statusMessage: apiKeyStatusMessage, onApiKeyChange: setGeminiApiKey, onSave: () => void saveApiKey(), onClear: () => void clearApiKey(), onClose: () => setIsSettingsOpen(false) } : null}
        browserSettings={isBrowserSettingsOpen ? { blockingEnabled: articleBrowserBlockingEnabled, isSaving: isBrowserSettingsSaving, statusMessage: browserSettingsStatusMessage, onBlockingEnabledChange: (enabled) => void changeArticleBrowserBlockingEnabled(enabled), onClose: () => setIsBrowserSettingsOpen(false) } : null}
        modelSettings={isModelSettingsOpen ? { titleModel, replyModel, isSaving: isModelSettingsSaving, onSave: (models) => void saveModelSettings(models), onClose: () => setIsModelSettingsOpen(false) } : null}
        residentPrompts={isResidentPromptsOpen ? { feeds: feedList, promptTargetFeedId, promptText, isPromptLoading, promptStatusMessage, onPromptTargetFeedIdChange: setPromptTargetFeedId, onPromptTextChange: setPromptText, onSavePrompt: () => void savePrompt(), onClearPrompt: () => void clearPrompt(), onClose: () => setIsResidentPromptsOpen(false) } : null}
        addFeed={isAddFeedOpen ? { addFeedTitle, addFeedUrl, addFeedError, generateTitleFromSummary: addFeedGenerateTitleFromSummary, skipTitleConversion: addFeedSkipTitleConversion, isAddFeedLoading, onTitleChange: (title) => updateAddFeedForm({ title }), onUrlChange: (url) => updateAddFeedForm({ url }), onGenerateTitleFromSummaryChange: (generateTitleFromSummary) => updateAddFeedForm({ generateTitleFromSummary }), onSkipTitleConversionChange: (skipTitleConversion) => updateAddFeedForm({ skipTitleConversion }), onAddFeed: () => void addFeed(), onClose: () => setIsAddFeedOpen(false) } : null}
        folder={folderModalMode ? { mode: folderModalMode, name: folderName, error: folderError, isSaving: isFolderSaving, onNameChange: (name) => updateFolderForm({ name }), onSave: () => void saveFolder(), onClose: closeFolderForm } : null}
        feedSettings={settingsFeed ? { feed: settingsFeed, title: settingsFeedTitle, generateTitleFromSummary: settingsGenerateTitleFromSummary, skipTitleConversion: settingsSkipTitleConversion, isSaving: isFeedSettingsSaving, error: feedSettingsError, onTitleChange: (title) => updateFeedSettingsForm({ title }), onGenerateTitleFromSummaryChange: (generateTitleFromSummary) => updateFeedSettingsForm({ generateTitleFromSummary }), onSkipTitleConversionChange: (skipTitleConversion) => updateFeedSettingsForm({ skipTitleConversion }), onSave: () => void saveFeedSettings(), onClose: closeFeedSettingsForm } : null}
        generationFailure={generationFailureThreadId ? { thread: threadList.find((thread) => thread.id === generationFailureThreadId), attempts: generationAttempts, isLoading: isGenerationAttemptsLoading, isRetrying: isRetryingGeneration, onRetry: () => void retryFailedGeneration(), onClose: closeGenerationFailure } : null}
        titleGenerationStatus={titleGenerationThreadId ? { thread: threadList.find((thread) => thread.id === titleGenerationThreadId), attempts: titleGenerationAttempts, isLoading: isTitleGenerationAttemptsLoading, onClose: () => setTitleGenerationThreadId(null) } : null}
        replyPopup={popupData ? { popupData, onMouseEnter: clearPopupTimeout, onMouseLeave: handleMouseLeaveWithDelay, onAnchorClick: scrollToPost } : null}
      />
    </main>
  );
}

function limitLogs(logs: AppLogEntry[]): AppLogEntry[] {
  return logs.length > maxRendererLogs ? logs.slice(logs.length - maxRendererLogs) : logs;
}
