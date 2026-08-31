import { useEffect, useRef, useState } from "react";
import type { AppLogEntry, FeedFolder, FeedSource, SmartView, ThreadDetail, ThreadListItem, TitleGenerationAttempt } from "../shared/types";
import { AppDialogs } from "./components/AppDialogs";
import { AppWorkspace } from "./components/AppWorkspace";
import { useAddFeedForm, useFeedSettingsForm, useFolderForm } from "./hooks/useAppForms";
import { usePaneLayout } from "./hooks/usePaneLayout";
import { useThreadSelection } from "./hooks/useThreadSelection";
import { useThreadGeneration } from "./hooks/useThreadGeneration";
import { allFeedsId, useFeedTree } from "./hooks/useFeedTree";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useThreadList } from "./hooks/useThreadList";
import { useFeedRefresh } from "./hooks/useFeedRefresh";
import { usePosting } from "./hooks/usePosting";
import { useAppSettings } from "./hooks/useAppSettings";
import { usePostPopup } from "./hooks/usePostPopup";

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
    onReload: () => reloadQueueSummary(),
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
  const {
    statistics: statisticsSettings,
    api: apiSettings,
    browser: browserSettings,
    models: modelSettings,
    prompts: promptSettings
  } = useAppSettings({ feeds: feedList, selectedFeedId, reloadFeeds });
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
  const settingsDefaultToArticleBrowser = feedSettingsForm?.defaultToArticleBrowser ?? false;
  const isFeedSettingsSaving = feedSettingsForm?.isSaving ?? false;
  const feedSettingsError = feedSettingsForm?.error ?? "";
  const replyBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [favoriteThreads, setFavoriteThreads] = useState<ThreadListItem[]>([]);
  const [isFavoriteCollapsed, setIsFavoriteCollapsed] = useState(false);
  const [readMarkerNo, setReadMarkerNo] = useState<number | null>(null);
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [threadViewMode, setThreadViewMode] = useState<"replies" | "browser">("replies");
  const [isArticleBrowserExpanded, setIsArticleBrowserExpanded] = useState(false);
  const [titleGenerationThreadId, setTitleGenerationThreadId] = useState<string | null>(null);
  const [titleGenerationAttempts, setTitleGenerationAttempts] = useState<TitleGenerationAttempt[]>([]);
  const [isTitleGenerationAttemptsLoading, setIsTitleGenerationAttemptsLoading] = useState(false);
  const readMetadataReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      clearExtractedPostId();
      replyBodyRef.current?.blur();
      if (!threadId) return;
      clearCompletedGeneration(threadId);
    },
    onThreadRead: scheduleReadMetadataReload,
    onReadMarkerChange: setReadMarkerNo
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
    reloadFeeds,
    reloadCurrentThreadList
  });
  const {
    popupData,
    extractedPostId,
    clearExtractedPostId,
    closePopup: closePostPopup,
    clearPopupTimeout,
    closePopupWithDelay: handleMouseLeaveWithDelay,
    scrollToPost,
    showReplies: handlePostNoMouseEnter,
    showAnchor: handleAnchorMouseEnter,
    showPostId: handlePostIdMouseEnter,
    toggleExtractedPostId: handleExtractPostId
  } = usePostPopup(selectedThread);
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
    reloadGeneratedQueue: () => void reloadGeneratedQueue(0, true),
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
    statisticsSettings.isOpen
    || apiSettings.isOpen
    || browserSettings.isOpen
    || modelSettings.isOpen
    || promptSettings.isOpen
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
    isArticleBrowserExpanded,
    extractedPostId,
    replyBodyRef,
    onSelectThread: selectThread,
    onSelectFeed: selectFeed,
    onSelectSmartView: selectSmartView,
    onMoveToNextPage: () => {
      if ((threadListPage + 1) * 100 < threadListTotalCount) {
        changeThreadListPage(threadListPage + 1, "first");
      }
    },
    onMoveToPreviousPage: () => {
      if (threadListPage > 0) changeThreadListPage(threadListPage - 1, "last");
    },
    onRefresh: () => void refreshSelectedFeed(),
    onGenerateResponses: () => void generateResponses(false),
    onGenerateReplies: () => void handleGenerateReplies(),
    onToggleFavorite: () => void toggleFavorite(),
    onToggleThreadRead: () => void toggleSelectedThreadRead(),
    onToggleThreadView: () => setThreadViewMode((current) => {
      if (current === "browser") {
        setIsArticleBrowserExpanded(false);
        return "replies";
      }
      return "browser";
    }),
    onToggleArticleBrowserExpanded: () => setIsArticleBrowserExpanded((current) => !current),
    onClearExtractedPost: clearExtractedPostId
  });

  useEffect(() => {
    if (!window.viperReader) return;
    return window.viperReader.onToggleArticleBrowserExpanded(() => {
      setIsArticleBrowserExpanded((current) => !current);
    });
  }, []);

  useEffect(() => {
    void loadFavoriteThreads();
    return () => {
      if (readMetadataReloadTimerRef.current) clearTimeout(readMetadataReloadTimerRef.current);
    };
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

  function scheduleReadMetadataReload() {
    if (readMetadataReloadTimerRef.current) clearTimeout(readMetadataReloadTimerRef.current);
    readMetadataReloadTimerRef.current = setTimeout(() => {
      readMetadataReloadTimerRef.current = null;
      void reloadFeeds();
    }, 150);
  }

  function selectThread(thread: ThreadListItem | ThreadDetail, feedSelection?: string) {
    if (smartView === "generated" && selectedThreadId && selectedThreadId !== thread.id) {
      void window.viperReader?.markThreadGenerationReviewed(selectedThreadId).then(reloadQueueSummary);
    }
    if (selectedThreadId !== thread.id) {
      switchReplyThread(selectedThreadId, thread.id);
      closePostPopup();
    }
    const feed = feedList.find((candidate) => candidate.id === thread.feedId);
    setIsArticleBrowserExpanded(false);
    setThreadViewMode(feed?.defaultToArticleBrowser ? "browser" : "replies");
    setSelectedFeedId(feedSelection ?? thread.feedId);
    setSelectedThreadId(thread.id);
  }

  async function toggleSelectedThreadRead() {
    if (selectedThreadId) await toggleThreadRead(selectedThreadId);
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
        settingsSkipTitleConversion,
        settingsDefaultToArticleBrowser
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

  const menuProps = {
    onOpenSettings: () => void apiSettings.open(),
    onOpenBrowserSettings: browserSettings.open,
    onOpenModelSettings: modelSettings.open,
    onOpenStatistics: () => void statisticsSettings.open(),
    onOpenResidentPrompts: promptSettings.open
  };
  const feedPaneProps = {
    feeds: feedList,
    folders: feedFolders,
    collapsedFolderIds,
    selectedTreeNode,
    favoriteThreads,
    logs,
    selectedFeedId,
    selectedThreadId,
    isFavoriteCollapsed,
    onSelectFeed: selectFeed,
    onSelectFolder: selectFolder,
    onToggleFolder: toggleFolder,
    onRefreshFeed: (feedId: string) => void refreshFeed(feedId),
    onAddFeed: () => setIsAddFeedOpen(true),
    onAddFolder: openCreateFolder,
    onDeleteSelectedNode: () => void deleteSelectedTreeNode(),
    onOpenFeedSettings: openFeedSettings,
    onRenameFolder: openRenameFolder,
    onSaveTreeLayout: saveFeedTreeLayout,
    onToggleFavoriteCollapsed: () => setIsFavoriteCollapsed((current) => !current),
    onSelectFavoriteThread: handleSelectFavoriteThread,
    allFeedsId,
    allUnreadCount,
    queueSummary,
    activeSmartView: smartView,
    onSelectSmartView: selectSmartView,
    feedTreeHeight,
    onStartFeedTreeResize: startFeedTreeResize
  };
  const threadListProps = {
    selectedFeed,
    selectedThreadId,
    threads: visibleThreads,
    generatingThreadIds,
    completedThreadIds: completedGenerationThreadIds,
    isRefreshing,
    refreshMessage,
    showUnreadOnly: effectiveShowUnreadOnly,
    isUnreadOnlyLocked,
    threadColumnLabels,
    threadGridColumns,
    threadListMinWidth,
    onRefresh: () => void refreshSelectedFeed(),
    onSelectThread: selectThreadById,
    onShowGenerationFailure: (threadId: string) => void showGenerationFailure(threadId),
    onShowTitleGenerationStatus: (threadId: string) => void showTitleGenerationStatus(threadId),
    onToggleUnreadOnly: () => {
      if (!isUnreadOnlyLocked) setShowUnreadOnly((current) => !current);
    },
    onMarkAllRead: () => void markAllThreadsRead(),
    onStartColumnResize: startThreadColumnResize,
    canRefresh: selectedFeedId !== allFeedsId || feedList.length > 0,
    refreshLabel: selectedFeedId === allFeedsId ? "全板更新" : "更新",
    page: threadListPage,
    pageSize: 100,
    totalCount: threadListTotalCount,
    onPreviousPage: () => changeThreadListPage(threadListPage - 1),
    onNextPage: () => changeThreadListPage(threadListPage + 1),
    smartView,
    queueSummary
  };
  const threadReaderProps = {
    selectedThread,
    isSelectedThreadGenerating,
    generationProgressMessage: selectedThread ? threadGenerationProgress.get(selectedThread.id) ?? "" : "",
    isRegeneratingTitle: isRegeneratingSelectedTitle,
    skipTitleConversion: feedList.find((feed) => feed.id === selectedThread?.feedId)?.skipTitleConversion ?? false,
    isPosting,
    postStatus,
    postError,
    replyName,
    replyMail,
    replyBody,
    readMarkerNo,
    extractedPostId,
    replyBodyRef,
    onToggleFavorite: () => void toggleFavorite(),
    onRegenerateThreadTitle: () => void regenerateSelectedThreadTitle(),
    onGenerateResponses: (force = false) => void generateResponses(force),
    onGenerateReplies: () => void handleGenerateReplies(),
    onPostMessage: handlePostMessage,
    onReplyNameChange: (name: string) => updateReplyComposer({ name }),
    onReplyMailChange: (mail: string) => updateReplyComposer({ mail }),
    onReplyBodyChange: setReplyBody,
    onReplyToPost: replyToPost,
    onScrollToPost: scrollToPost,
    onPostNoMouseEnter: handlePostNoMouseEnter,
    onPostNoMouseLeave: handleMouseLeaveWithDelay,
    onPostIdClick: handleExtractPostId,
    onPostIdMouseEnter: handlePostIdMouseEnter,
    onPostIdMouseLeave: handleMouseLeaveWithDelay,
    onAnchorMouseEnter: handleAnchorMouseEnter,
    onAnchorMouseLeave: handleMouseLeaveWithDelay,
    isArticlePaneVisible: shouldShowArticlePane,
    onToggleArticlePane: toggleArticlePane,
    onShowArticleBrowser: () => setThreadViewMode("browser")
  };

  return (
    <main className="app-frame">
      <AppWorkspace
        menu={menuProps}
        feedPane={feedPaneProps}
        threadList={threadListProps}
        articleBrowser={{
          selectedThread,
          isActive: true,
          isSuspended: isArticleBrowserSuspended,
          isExpanded: isArticleBrowserExpanded,
          onShowReplies: () => {
            setIsArticleBrowserExpanded(false);
            setThreadViewMode("replies");
          },
          onToggleExpanded: () => setIsArticleBrowserExpanded((current) => !current)
        }}
        threadReader={threadReaderProps}
        articleBody={{ selectedThread, articleBody, isLoading: isArticleBodyLoading, onClose: toggleArticlePane }}
        threadViewMode={threadViewMode}
        isArticleBrowserExpanded={isArticleBrowserExpanded}
        showArticlePane={shouldShowArticlePane}
        feedPaneWidth={feedPaneWidth}
        threadListHeight={threadListHeight}
        articlePaneWidth={articlePaneWidth}
        appShellRef={appShellRef}
        contentPaneRef={contentPaneRef}
        threadContentRef={threadContentRef}
        onStartFeedPaneResize={startFeedPaneResize}
        onStartVerticalResize={startVerticalResize}
        onStartArticlePaneResize={startArticlePaneResize}
      />

      <AppDialogs
        statistics={statisticsSettings.isOpen ? { statistics: statisticsSettings.value, isLoading: statisticsSettings.isLoading, onClose: statisticsSettings.close } : null}
        settings={apiSettings.isOpen ? { apiKey: apiSettings.key, apiKeyStatus: apiSettings.status, isSaving: apiSettings.isSaving, statusMessage: apiSettings.message, onApiKeyChange: apiSettings.setKey, onSave: () => void apiSettings.save(), onClear: () => void apiSettings.clear(), onClose: apiSettings.close } : null}
        browserSettings={browserSettings.isOpen ? { blockingEnabled: browserSettings.blockingEnabled, isSaving: browserSettings.isSaving, statusMessage: browserSettings.message, onBlockingEnabledChange: (enabled) => void browserSettings.setBlocking(enabled), onClose: browserSettings.close } : null}
        modelSettings={modelSettings.isOpen ? { titleModel: modelSettings.titleModel, replyModel: modelSettings.replyModel, isSaving: modelSettings.isSaving, onSave: (models) => void modelSettings.save(models), onClose: modelSettings.close } : null}
        residentPrompts={promptSettings.isOpen ? { feeds: feedList, promptTargetFeedId: promptSettings.feedId, promptText: promptSettings.text, isPromptLoading: promptSettings.isLoading, promptStatusMessage: promptSettings.message, onPromptTargetFeedIdChange: promptSettings.setFeedId, onPromptTextChange: promptSettings.setText, onSavePrompt: () => void promptSettings.save(), onClearPrompt: () => void promptSettings.clear(), onClose: promptSettings.close } : null}
        addFeed={isAddFeedOpen ? { addFeedTitle, addFeedUrl, addFeedError, generateTitleFromSummary: addFeedGenerateTitleFromSummary, skipTitleConversion: addFeedSkipTitleConversion, isAddFeedLoading, onTitleChange: (title) => updateAddFeedForm({ title }), onUrlChange: (url) => updateAddFeedForm({ url }), onGenerateTitleFromSummaryChange: (generateTitleFromSummary) => updateAddFeedForm({ generateTitleFromSummary }), onSkipTitleConversionChange: (skipTitleConversion) => updateAddFeedForm({ skipTitleConversion }), onAddFeed: () => void addFeed(), onClose: () => setIsAddFeedOpen(false) } : null}
        folder={folderModalMode ? { mode: folderModalMode, name: folderName, error: folderError, isSaving: isFolderSaving, onNameChange: (name) => updateFolderForm({ name }), onSave: () => void saveFolder(), onClose: closeFolderForm } : null}
        feedSettings={settingsFeed ? { feed: settingsFeed, title: settingsFeedTitle, generateTitleFromSummary: settingsGenerateTitleFromSummary, skipTitleConversion: settingsSkipTitleConversion, defaultToArticleBrowser: settingsDefaultToArticleBrowser, isSaving: isFeedSettingsSaving, error: feedSettingsError, onTitleChange: (title) => updateFeedSettingsForm({ title }), onGenerateTitleFromSummaryChange: (generateTitleFromSummary) => updateFeedSettingsForm({ generateTitleFromSummary }), onSkipTitleConversionChange: (skipTitleConversion) => updateFeedSettingsForm({ skipTitleConversion }), onDefaultToArticleBrowserChange: (defaultToArticleBrowser) => updateFeedSettingsForm({ defaultToArticleBrowser }), onSave: () => void saveFeedSettings(), onClose: closeFeedSettingsForm } : null}
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
