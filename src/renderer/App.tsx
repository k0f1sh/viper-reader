import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { AppLogEntry, ArticleBodyContent, FeedSource, GeminiApiKeyStatus, ReplyRating, ResidentPromptVersion, StatisticsSummary, ThreadDetail, ThreadListItem, ThreadPost } from "../shared/types";
import { AddFeedModal } from "./components/AddFeedModal";
import { ArticleBodyPane } from "./components/ArticleBodyPane";
import { ArticleBrowserPane } from "./components/ArticleBrowserPane";
import { BrowserSettingsModal } from "./components/BrowserSettingsModal";
import { FeedPane } from "./components/FeedPane";
import { FeedSettingsModal } from "./components/FeedSettingsModal";
import { MenuBar } from "./components/MenuBar";
import { ModelSettingsModal } from "./components/ModelSettingsModal";
import { ReplyPopup } from "./components/ReplyPopup";
import { ResidentPromptsModal } from "./components/ResidentPromptsModal";
import { SettingsModal } from "./components/SettingsModal";
import { StatisticsModal } from "./components/StatisticsModal";
import { ThreadListPane } from "./components/ThreadListPane";
import { ThreadReaderPane } from "./components/ThreadReaderPane";

const threadColumnLabels = ["スレタイ", "取得元", "元タイトル", "レス", "日時 ▼", "URL"] as const;
const defaultThreadColumnWidths = [360, 170, 300, 54, 126, 260];
const minThreadColumnWidths = [220, 100, 180, 44, 96, 140];
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
  const [threadList, setThreadList] = useState<ThreadListItem[]>([]);
  const [threadListPage, setThreadListPage] = useState(0);
  const [threadListTotalCount, setThreadListTotalCount] = useState(0);
  const [allUnreadCount, setAllUnreadCount] = useState(0);
  const [selectedFeedId, setSelectedFeedId] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const selectedThreadIdRef = useRef<string | undefined>(undefined);
  selectedThreadIdRef.current = selectedThreadId;
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
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
  const [addFeedGenerateTitleFromSummary, setAddFeedGenerateTitleFromSummary] = useState(false);
  const [addFeedError, setAddFeedError] = useState("");
  const [isAddFeedLoading, setIsAddFeedLoading] = useState(false);
  const [settingsFeed, setSettingsFeed] = useState<FeedSource | null>(null);
  const [settingsGenerateTitleFromSummary, setSettingsGenerateTitleFromSummary] = useState(false);
  const [isFeedSettingsSaving, setIsFeedSettingsSaving] = useState(false);
  const [feedSettingsError, setFeedSettingsError] = useState("");
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
  const [replyModel, setReplyModel] = useState("gemini-3.6-flash");
  const [titleModel, setTitleModel] = useState("gemini-3.5-flash-lite");
  const [optimizerModel, setOptimizerModel] = useState("gemini-3.6-flash");
  const popupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const replyBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [favoriteThreads, setFavoriteThreads] = useState<ThreadListItem[]>([]);
  const [isFavoriteCollapsed, setIsFavoriteCollapsed] = useState(false);
  const [readMarkerNo, setReadMarkerNo] = useState<number | null>(null);
  const [extractedPostId, setExtractedPostId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AppLogEntry[]>([]);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [threadViewMode, setThreadViewMode] = useState<"replies" | "browser">("replies");

  const selectedFeed = selectedFeedId === allFeedsId
    ? { id: allFeedsId, title: "全板共通", url: "登録済みの全板・記事時刻の新しい順", unreadCount: feedList.reduce((sum, feed) => sum + feed.unreadCount, 0), lastFetchedAt: null, generateTitleFromSummary: false }
    : feedList.find((feed) => feed.id === selectedFeedId) ?? feedList[0];
  const isSelectedThreadGenerating = selectedThread ? generatingThreadIds.has(selectedThread.id) : false;
  const isRegeneratingSelectedTitle = selectedThread ? regeneratingTitleThreadId === selectedThread.id : false;
  const shouldShowArticlePane = threadViewMode === "replies" && isArticlePaneVisible && Boolean(selectedThread && selectedThread.posts.length > 1);
  const isArticleBrowserSuspended =
    isStatisticsOpen
    || isSettingsOpen
    || isBrowserSettingsOpen
    || isModelSettingsOpen
    || isResidentPromptsOpen
    || isAddFeedOpen
    || settingsFeed !== null;
  const threadGridColumns = threadColumnWidths.map((width) => `${width}px`).join(" ");
  const threadListMinWidth = threadColumnWidths.reduce((total, width) => total + width, 0);
  const visibleThreads = showUnreadOnly ? threadList.filter((thread) => !thread.isRead) : threadList;

  useEffect(() => {
    void reloadFeeds();
    void loadSettings();
    void loadFavoriteThreads();
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
    void reloadThreads(selectedFeedId, undefined, 0);
  }, [selectedFeedId, showUnreadOnly]);

  useEffect(() => {
    setReadMarkerNo(null);
    setExtractedPostId(null);
    if (!selectedThreadId || !window.viperReader) {
      setSelectedThread(null);
      return;
    }
    // スレッド切り替え時は、明示操作なしに書き込み欄へフォーカスを残さない
    replyBodyRef.current?.blur();

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
            setSelectedThreadId(undefined);
            setSelectedThread(null);
          }
          return;
        }
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

    const [nextFeeds, nextAllUnreadCount] = await Promise.all([
      window.viperReader.listFeeds(),
      window.viperReader.countUnreadArticles()
    ]);
    setFeedList(nextFeeds);
    setAllUnreadCount(nextAllUnreadCount);
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

  function selectThreadById(threadId: string) {
    const thread = threadList.find((candidate) => candidate.id === threadId);
    if (thread) {
      selectThread(thread, selectedFeedId === allFeedsId ? allFeedsId : undefined);
    }
  }

  function selectThread(thread: ThreadListItem | ThreadDetail, feedSelection?: string) {
    if (selectedThreadId !== thread.id) {
      if (selectedThreadId) {
        replyDraftsRef.current.set(selectedThreadId, replyBody);
      }
      setReplyBody(replyDraftsRef.current.get(thread.id) ?? "");
      setPostError("");
      setPostStatus("idle");
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

      if (event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "j" || event.key === "k")) {
        if (!document.querySelector("[role='dialog']")) {
          scrollPosts(event.key === "j" ? 1 : -1);
          event.preventDefault();
        }
        return;
      }

      if (target?.matches("input, textarea, select, [contenteditable='true']") || primaryModifier || event.altKey) return;
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
        const feedIds = [allFeedsId, ...feedList.map((feed) => feed.id)];
        const currentIndex = feedIds.indexOf(selectedFeedId);
        const delta = event.key === "l" ? 1 : -1;
        const nextIndex = currentIndex < 0 ? (delta > 0 ? 0 : feedIds.length - 1) : currentIndex + delta;
        const nextFeedId = feedIds[nextIndex];
        if (nextFeedId) {
          event.preventDefault();
          selectFeed(nextFeedId);
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
      } else if (event.key === "o") {
        event.preventDefault();
        setThreadViewMode((current) => current === "replies" ? "browser" : "replies");
      } else if (event.key === "U") {
        event.preventDefault(); void toggleSelectedThreadRead();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [feedList, visibleThreads, selectedThreadId, selectedThread, selectedFeedId, isRefreshing, isSelectedThreadGenerating, isPosting, extractedPostId, threadViewMode]);

  async function loadSettings() {
    if (!window.viperReader) {
      return;
    }

    try {
      const [height, widthsJson, model, savedTitleModel, savedOptimizerModel, savedFeedPaneWidth, savedArticlePaneWidth, savedArticlePaneVisible, savedArticleBrowserBlockingEnabled] = await Promise.all([
        window.viperReader.getUserSetting("threadListHeight"),
        window.viperReader.getUserSetting("threadColumnWidthsV2"),
        window.viperReader.getUserSetting("replyModel"),
        window.viperReader.getUserSetting("titleModel"),
        window.viperReader.getUserSetting("optimizerModel"),
        window.viperReader.getUserSetting("feedPaneWidth"),
        window.viperReader.getUserSetting("articlePaneWidth"),
        window.viperReader.getUserSetting("articlePaneVisible"),
        window.viperReader.getUserSetting("articleBrowserBlockingEnabled")
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
      if (savedTitleModel) {
        setTitleModel(savedTitleModel);
      }
      if (savedOptimizerModel) {
        setOptimizerModel(savedOptimizerModel);
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
      setArticleBrowserBlockingEnabled(savedArticleBrowserBlockingEnabled !== "false");

    } catch (err) {
      console.error("ユーザー設定の読込に失敗しました:", err);
    }
  }

  async function saveModelSettings(models: { titleModel: string; replyModel: string; optimizerModel: string }) {
    if (!window.viperReader) return;
    setIsModelSettingsSaving(true);
    try {
      await Promise.all([
        window.viperReader.saveUserSetting("titleModel", models.titleModel),
        window.viperReader.saveUserSetting("replyModel", models.replyModel),
        window.viperReader.saveUserSetting("optimizerModel", models.optimizerModel)
      ]);
      setTitleModel(models.titleModel);
      setReplyModel(models.replyModel);
      setOptimizerModel(models.optimizerModel);
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
    setSelectedFeedId(feedId);
    setRefreshMessage("");
  }

  async function reorderFeeds(feedIds: string[]) {
    if (!window.viperReader) return;
    const previousFeeds = feedList;
    const feedsById = new Map(previousFeeds.map((feed) => [feed.id, feed]));
    setFeedList(feedIds.map((feedId) => feedsById.get(feedId)).filter((feed): feed is FeedSource => Boolean(feed)));
    try {
      await window.viperReader.reorderFeedSources(feedIds);
    } catch {
      setFeedList(previousFeeds);
      alert("板一覧の並び替えに失敗しました。");
    }
  }

  async function addFeed() {
    if (!window.viperReader || !addFeedTitle.trim() || !addFeedUrl.trim()) {
      return;
    }

    setIsAddFeedLoading(true);
    setAddFeedError("");
    try {
      const newFeed = await window.viperReader.addFeedSource(
        addFeedTitle.trim(),
        addFeedUrl.trim(),
        addFeedGenerateTitleFromSummary
      );
      setFeedList((current) => [...current, newFeed]);
      setSelectedFeedId(newFeed.id);
      setIsAddFeedOpen(false);
      setAddFeedTitle("");
      setAddFeedUrl("");
      setAddFeedGenerateTitleFromSummary(false);
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
      if (selectedThread?.feedId === selectedFeedId) {
        setSelectedThreadId(undefined);
        setSelectedThread(null);
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

  function openFeedSettings(feed: FeedSource) {
    setSettingsFeed(feed);
    setSettingsGenerateTitleFromSummary(feed.generateTitleFromSummary);
    setFeedSettingsError("");
  }

  async function saveFeedSettings() {
    if (!window.viperReader || !settingsFeed) return;
    setIsFeedSettingsSaving(true);
    setFeedSettingsError("");
    try {
      const updated = await window.viperReader.updateFeedTitleGenerationSetting(
        settingsFeed.id,
        settingsGenerateTitleFromSummary
      );
      setFeedList((current) => current.map((feed) => feed.id === updated.id ? updated : feed));
      setSettingsFeed(null);
    } catch (err) {
      setFeedSettingsError(err instanceof Error ? err.message : "設定の保存に失敗しました。");
    } finally {
      setIsFeedSettingsSaving(false);
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
    setThreadGenerationProgress((current) => {
      const next = new Map(current);
      next.set(selectedThread.id, "レス生成を準備中...");
      return next;
    });

    try {
      await window.viperReader.generateThreadResponses(selectedThread.id, force);
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
      void window.viperReader?.saveUserSetting("threadColumnWidthsV2", JSON.stringify(currentWidths));
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
        onOpenSettings={() => void openSettings()}
        onOpenBrowserSettings={() => {
          setBrowserSettingsStatusMessage("");
          setIsBrowserSettingsOpen(true);
        }}
        onOpenModelSettings={() => setIsModelSettingsOpen(true)}
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
          onOpenFeedSettings={openFeedSettings}
          onReorderFeeds={(feedIds) => void reorderFeeds(feedIds)}
          onToggleFavoriteCollapsed={() => setIsFavoriteCollapsed((current) => !current)}
          onSelectFavoriteThread={handleSelectFavoriteThread}
          allFeedsId={allFeedsId}
          allUnreadCount={allUnreadCount}
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
            showUnreadOnly={showUnreadOnly}
            threadColumnLabels={threadColumnLabels}
            threadGridColumns={threadGridColumns}
            threadListMinWidth={threadListMinWidth}
            onRefresh={() => void refreshSelectedFeed()}
            onSelectThread={selectThreadById}
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
          optimizerModel={optimizerModel}
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
          generateTitleFromSummary={addFeedGenerateTitleFromSummary}
          isAddFeedLoading={isAddFeedLoading}
          onTitleChange={setAddFeedTitle}
          onUrlChange={setAddFeedUrl}
          onGenerateTitleFromSummaryChange={setAddFeedGenerateTitleFromSummary}
          onAddFeed={() => void addFeed()}
          onClose={() => setIsAddFeedOpen(false)}
        />
      ) : null}

      {settingsFeed ? (
        <FeedSettingsModal
          feed={settingsFeed}
          generateTitleFromSummary={settingsGenerateTitleFromSummary}
          isSaving={isFeedSettingsSaving}
          error={feedSettingsError}
          onGenerateTitleFromSummaryChange={setSettingsGenerateTitleFromSummary}
          onSave={() => void saveFeedSettings()}
          onClose={() => setSettingsFeed(null)}
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
