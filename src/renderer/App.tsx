import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { AppLogEntry, FeedSource, ReplyRating, ResidentPromptVersion, StatisticsSummary, ThreadDetail, ThreadListItem, ThreadPost } from "../shared/types";
import { AddFeedModal } from "./components/AddFeedModal";
import { FeedPane } from "./components/FeedPane";
import { MenuBar } from "./components/MenuBar";
import { ReplyPopup } from "./components/ReplyPopup";
import { ResidentPromptsModal } from "./components/ResidentPromptsModal";
import { StatisticsModal } from "./components/StatisticsModal";
import { ThreadListPane } from "./components/ThreadListPane";
import { ThreadReaderPane } from "./components/ThreadReaderPane";

const threadColumnLabels = ["スレタイ", "元タイトル", "レス", "取得元", "日時 ▼", "URL"] as const;
const defaultThreadColumnWidths = [360, 300, 54, 170, 126, 260];
const minThreadColumnWidths = [220, 180, 44, 100, 96, 140];
const maxRendererLogs = 300;

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
  const [selectedFeedId, setSelectedFeedId] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
  const [generatingThreadIds, setGeneratingThreadIds] = useState<Set<string>>(() => new Set());
  const [completedGenerationThreadIds, setCompletedGenerationThreadIds] = useState<Set<string>>(() => new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [regeneratingTitleThreadId, setRegeneratingTitleThreadId] = useState<string | null>(null);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [isStatisticsOpen, setIsStatisticsOpen] = useState(false);
  const [isStatisticsLoading, setIsStatisticsLoading] = useState(false);
  const [statistics, setStatistics] = useState<StatisticsSummary | null>(null);
  const [isResidentPromptsOpen, setIsResidentPromptsOpen] = useState(false);
  const [promptTargetFeedId, setPromptTargetFeedId] = useState("");
  const [promptText, setPromptText] = useState("");
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [promptStatusMessage, setPromptStatusMessage] = useState("");
  const [promptVersions, setPromptVersions] = useState<ResidentPromptVersion[]>([]);
  const [hasPromptProposal, setHasPromptProposal] = useState(false);
  const [threadListHeight, setThreadListHeight] = useState(42);
  const [threadColumnWidths, setThreadColumnWidths] = useState(defaultThreadColumnWidths);
  const contentPaneRef = useRef<HTMLElement>(null);
  const [isAddFeedOpen, setIsAddFeedOpen] = useState(false);
  const [addFeedTitle, setAddFeedTitle] = useState("");
  const [addFeedUrl, setAddFeedUrl] = useState("");
  const [addFeedError, setAddFeedError] = useState("");
  const [isAddFeedLoading, setIsAddFeedLoading] = useState(false);
  const [replyName, setReplyName] = useState("");
  const [replyMail, setReplyMail] = useState("sage");
  const [replyBody, setReplyBody] = useState("");
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
  const [logs, setLogs] = useState<AppLogEntry[]>([]);

  const selectedFeed = feedList.find((feed) => feed.id === selectedFeedId) ?? feedList[0];
  const isSelectedThreadGenerating = selectedThread ? generatingThreadIds.has(selectedThread.id) : false;
  const isRegeneratingSelectedTitle = selectedThread ? regeneratingTitleThreadId === selectedThread.id : false;
  const threadGridColumns = threadColumnWidths.map((width) => `${width}px`).join(" ");
  const threadListMinWidth = threadColumnWidths.reduce((total, width) => total + width, 0);

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

    void reloadThreads(selectedFeedId);
  }, [selectedFeedId]);

  useEffect(() => {
    setReadMarkerNo(null);
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
        setSelectedThread(thread);
        if (thread) {
          setThreadList((currentThreads) =>
            currentThreads.map((currentThread) =>
              currentThread.id === thread.id ? { ...currentThread, ...thread, isRead: true } : currentThread
            )
          );
          void reloadFeeds();
        }
      })
      .catch(() => {
        setSelectedThread(null);
      });
  }, [selectedThreadId]);

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

    if (nextFeeds.length > 0) {
      setSelectedFeedId((currentFeedId) =>
        nextFeeds.some((feed) => feed.id === currentFeedId) ? currentFeedId : nextFeeds[0].id
      );
    }
  }

  async function reloadThreads(feedId: string, preferredThreadId?: string) {
    if (!window.viperReader) {
      return;
    }

    const nextThreads = await window.viperReader.listThreads(feedId);
    setThreadList(nextThreads);
    setSelectedThreadId(
      preferredThreadId && nextThreads.some((thread) => thread.id === preferredThreadId)
        ? preferredThreadId
        : nextThreads[0]?.id
    );
  }

  async function loadSettings() {
    if (!window.viperReader) {
      return;
    }

    try {
      const height = await window.viperReader.getUserSetting("threadListHeight");
      if (height) {
        setThreadListHeight(parseFloat(height));
      }

      const widthsJson = await window.viperReader.getUserSetting("threadColumnWidths");
      if (widthsJson) {
        const widths = JSON.parse(widthsJson) as unknown;
        if (Array.isArray(widths) && widths.length === defaultThreadColumnWidths.length) {
          setThreadColumnWidths(widths as number[]);
        }
      }

      const model = await window.viperReader.getUserSetting("replyModel");
      if (model) {
        setReplyModel(model);
      }
    } catch (err) {
      console.error("ユーザー設定の読込に失敗しました:", err);
    }
  }

  async function handleReplyModelChange(newModel: string) {
    setReplyModel(newModel);
    if (window.viperReader) {
      await window.viperReader.saveUserSetting("replyModel", newModel);
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
    if (!selectedFeedId || !window.viperReader) {
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
    try {
      await window.viperReader.rateReplyRun(runId, rating, tags);
      setSelectedThread((current) => current ? {
        ...current,
        replyRuns: current.replyRuns.map((run) => run.id === runId ? { ...run, rating, feedbackTags: tags } : run)
      } : current);
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "レス評価の保存に失敗しました。");
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
      await reloadThreads(feedId);
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
    if (selectedFeed) {
      await refreshFeed(selectedFeed.id);
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

    setRegeneratingTitleThreadId(selectedThread.id);
    setPostError("");

    try {
      const result = await window.viperReader.regenerateVipTitle(selectedThread.id);
      if (result) {
        setSelectedThread(result);
        setThreadList((currentThreads) =>
          currentThreads.map((currentThread) =>
            currentThread.id === result.id ? { ...currentThread, ...result, isRead: true } : currentThread
          )
        );
        if (selectedFeedId) {
          await reloadThreads(selectedFeedId, result.id);
        }
      }
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "スレタイ再生成に失敗しました。");
    } finally {
      setRegeneratingTitleThreadId(null);
    }
  }

  async function handlePostMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedThread || !window.viperReader || isPosting || !replyBody.trim()) {
      return;
    }

    // 書き込み前の最後のレス番号を記録してセパレーターに使う
    const markerNo = selectedThread.posts.reduce((max, p) => Math.max(max, p.no), 0);

    setIsPosting(true);
    setPostError("");
    setPostStatus("idle");

    try {
      const result = await window.viperReader.postMessage(
        selectedThread.id,
        replyName,
        replyMail,
        replyBody
      );

      if (result) {
        setReadMarkerNo(markerNo);
        setSelectedThread(result);
        setReplyBody("");
        // スレッド一覧のレス数や既読を更新
        setThreadList((currentThreads) =>
          currentThreads.map((currentThread) =>
            currentThread.id === result.id ? { ...currentThread, ...result, isRead: true } : currentThread
          )
        );
        void reloadFeeds();

        scrollReadMarkerToTop();
      }
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "書き込みに失敗しました。");
      setIsPosting(false);
      setPostStatus("idle");
    }
  }

  async function handleGenerateReplies() {
    if (!selectedThread || !window.viperReader || isPosting) return;

    // 再読み込み前の最後のレス番号を記録してセパレーターに使う
    const markerNo = selectedThread.posts.reduce((max, p) => Math.max(max, p.no), 0);

    setIsPosting(true);
    setPostError("");

    const unsubscribePostStatus = window.viperReader.onPostStatus((data) => {
      if (data.threadId === selectedThread.id) {
        setPostStatus(data.status);
      }
    });

    try {
      const result = await window.viperReader.generateReplies(selectedThread.id);
      if (result) {
        setReadMarkerNo(markerNo);
        setSelectedThread(result);
        
        setThreadList((currentThreads) =>
          currentThreads.map((currentThread) =>
            currentThread.id === result.id ? { ...currentThread, ...result, isRead: true } : currentThread
          )
        );
        void reloadFeeds();

        scrollReadMarkerToTop();
      }
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "レス生成に失敗しました。");
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
    const nextFavorite = !selectedThread.isFavorite;
    try {
      await window.viperReader.toggleFavorite(selectedThread.id, nextFavorite);
      
      setSelectedThread((current) => current ? { ...current, isFavorite: nextFavorite } : null);
      
      setThreadList((currentList) =>
        currentList.map((item) =>
          item.id === selectedThread.id ? { ...item, isFavorite: nextFavorite } : item
        )
      );

      void loadFavoriteThreads();
    } catch (err) {
      console.error("お気に入りの更新に失敗しました:", err);
    }
  }

  function handleSelectFavoriteThread(thread: ThreadListItem) {
    setSelectedFeedId(thread.feedId);
    setSelectedThreadId(thread.id);
  }

  function scrollToPost(postNo: number) {
    const element = document.getElementById(`post-${postNo}`);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      element.classList.add("highlighted-post");
      setTimeout(() => {
        element.classList.remove("highlighted-post");
      }, 2000);
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

  return (
    <main className="app-frame">
      <MenuBar
        replyModel={replyModel}
        onReplyModelChange={(model) => void handleReplyModelChange(model)}
        onOpenStatistics={openStatistics}
        onOpenResidentPrompts={openResidentPrompts}
        hasPromptProposal={hasPromptProposal}
      />

      <div className="app-shell">
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
        />

        <section
          className="content-pane"
          ref={contentPaneRef}
          style={{ "--thread-list-height": `${threadListHeight}%` } as CSSProperties}
        >
          <ThreadListPane
            selectedFeed={selectedFeed}
            selectedThread={selectedThread}
            threads={threadList}
            generatingThreadIds={generatingThreadIds}
            completedThreadIds={completedGenerationThreadIds}
            isRefreshing={isRefreshing}
            refreshMessage={refreshMessage}
            threadColumnLabels={threadColumnLabels}
            threadGridColumns={threadGridColumns}
            threadListMinWidth={threadListMinWidth}
            onRefresh={() => void refreshSelectedFeed()}
            onSelectThread={setSelectedThreadId}
            onStartColumnResize={startThreadColumnResize}
          />

          <div
            aria-label="スレタイ一覧とスレ本文の境界"
            className="pane-splitter"
            onMouseDown={startVerticalResize}
            role="separator"
          />

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
            onAnchorMouseEnter={handleAnchorMouseEnter}
            onAnchorMouseLeave={handleAnchorMouseLeave}
          />
        </section>
      </div>

      {isStatisticsOpen ? (
        <StatisticsModal
          statistics={statistics}
          isLoading={isStatisticsLoading}
          onClose={() => setIsStatisticsOpen(false)}
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
