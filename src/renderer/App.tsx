import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { FeedSource, StatisticsSummary, ThreadDetail, ThreadListItem, ThreadPost } from "../shared/types";

const threadColumnLabels = ["スレタイ", "元タイトル", "レス", "取得元", "日時 ▼", "URL"] as const;
const defaultThreadColumnWidths = [360, 300, 54, 170, 126, 260];
const minThreadColumnWidths = [220, 180, 44, 100, 96, 140];

export function App() {
  const [feedList, setFeedList] = useState<FeedSource[]>([]);
  const [threadList, setThreadList] = useState<ThreadListItem[]>([]);
  const [selectedFeedId, setSelectedFeedId] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | undefined>();
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
  const [generatingThreadIds, setGeneratingThreadIds] = useState<Set<string>>(() => new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [isStatisticsOpen, setIsStatisticsOpen] = useState(false);
  const [isStatisticsLoading, setIsStatisticsLoading] = useState(false);
  const [statistics, setStatistics] = useState<StatisticsSummary | null>(null);
  const [isResidentPromptsOpen, setIsResidentPromptsOpen] = useState(false);
  const [promptTargetFeedId, setPromptTargetFeedId] = useState("");
  const [promptText, setPromptText] = useState("");
  const [isPromptLoading, setIsPromptLoading] = useState(false);
  const [promptStatusMessage, setPromptStatusMessage] = useState("");
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
  const [favoriteThreads, setFavoriteThreads] = useState<ThreadListItem[]>([]);
  const [isFavoriteCollapsed, setIsFavoriteCollapsed] = useState(false);

  const selectedFeed = feedList.find((feed) => feed.id === selectedFeedId) ?? feedList[0];
  const isSelectedThreadGenerating = selectedThread ? generatingThreadIds.has(selectedThread.id) : false;
  const threadGridColumns = threadColumnWidths.map((width) => `${width}px`).join(" ");
  const threadListMinWidth = threadColumnWidths.reduce((total, width) => total + width, 0);

  useEffect(() => {
    void reloadFeeds();
    void loadSettings();
    void loadFavoriteThreads();
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
    if (!selectedThreadId || !window.viperReader) {
      setSelectedThread(null);
      return;
    }

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
    if (!window.viperReader) {
      return;
    }

    return window.viperReader.onThreadGenerationComplete((status) => {
      setGeneratingThreadIds((currentIds) => {
        const nextIds = new Set(currentIds);
        nextIds.delete(status.threadId);
        return nextIds;
      });

      if (status.status === "done" && status.threadId === selectedThreadId) {
        void window.viperReader?.getThread(status.threadId).then((thread) => {
          setSelectedThread(thread);
          if (thread) {
            setThreadList((currentThreads) =>
              currentThreads.map((currentThread) =>
                currentThread.id === thread.id ? { ...currentThread, ...thread, isRead: true } : currentThread
              )
            );
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

    if (nextFeeds.length > 0) {
      setSelectedFeedId((currentFeedId) =>
        nextFeeds.some((feed) => feed.id === currentFeedId) ? currentFeedId : nextFeeds[0].id
      );
    }
  }

  async function reloadThreads(feedId: string) {
    if (!window.viperReader) {
      return;
    }

    const nextThreads = await window.viperReader.listThreads(feedId);
    setThreadList(nextThreads);
    setSelectedThreadId(nextThreads[0]?.id);
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
    void window.viperReader
      .getFeedResidentPrompt(promptTargetFeedId)
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

  async function refreshSelectedFeed() {
    if (!window.viperReader || !selectedFeed || isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    setRefreshMessage("RSS取得中...");
    const unsubscribeProgress = window.viperReader.onRefreshProgress((progress) => {
      if (progress.feedId === selectedFeed.id) {
        setRefreshMessage(progress.message);
      }
    });

    try {
      const result = await window.viperReader.refreshFeed(selectedFeed.id);
      await reloadFeeds();
      await reloadThreads(selectedFeed.id);
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

  async function handlePostMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedThread || !window.viperReader || isPosting || !replyBody.trim()) {
      return;
    }

    setIsPosting(true);
    setPostError("");
    setPostStatus("idle");

    const unsubscribePostStatus = window.viperReader.onPostStatus((data) => {
      if (data.threadId === selectedThread.id) {
        setPostStatus(data.status);
      }
    });

    try {
      const result = await window.viperReader.postMessage(
        selectedThread.id,
        replyName,
        replyMail,
        replyBody
      );

      if (result) {
        setSelectedThread(result);
        setReplyBody("");
        // スレッド一覧のレス数や既読を更新
        setThreadList((currentThreads) =>
          currentThreads.map((currentThread) =>
            currentThread.id === result.id ? { ...currentThread, ...result, isRead: true } : currentThread
          )
        );
        void reloadFeeds();

        // 投稿成功時に最下部にスクロールする
        setTimeout(() => {
          const postsContainer = document.querySelector(".posts");
          if (postsContainer) {
            postsContainer.scrollTop = postsContainer.scrollHeight;
          }
        }, 100);
      }
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "書き込みに失敗しました。");
    } finally {
      unsubscribePostStatus();
      setIsPosting(false);
      setPostStatus("idle");
    }
  }

  async function handleGenerateReplies() {
    if (!selectedThread || !window.viperReader || isPosting) return;

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
        setSelectedThread(result);
        
        setThreadList((currentThreads) =>
          currentThreads.map((currentThread) =>
            currentThread.id === result.id ? { ...currentThread, ...result, isRead: true } : currentThread
          )
        );
        void reloadFeeds();

        setTimeout(() => {
          const postsContainer = document.querySelector(".posts");
          if (postsContainer) {
            postsContainer.scrollTop = postsContainer.scrollHeight;
          }
        }, 100);
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
      <nav className="menu-bar" aria-label="メニュー">
        <button className="menu-item" type="button">
          ファイル
        </button>
        <button className="menu-item" type="button">
          表示
        </button>
        <button className="menu-item" onClick={openStatistics} type="button">
          統計情報
        </button>
        <button className="menu-item" onClick={openResidentPrompts} type="button">
          住民設定
        </button>
        <div className="menu-select-wrapper">
          <label htmlFor="reply-model-select">レスモデル:</label>
          <select
            id="reply-model-select"
            className="menu-select"
            value={replyModel}
            onChange={(e) => handleReplyModelChange(e.target.value)}
          >
            <option value="gemini-3.1-flash-lite">3.1 flash lite</option>
            <option value="gemini-3.5-flash">3.5 flash</option>
          </select>
        </div>
      </nav>

      <div className="app-shell">
        <aside className="feed-pane" aria-label="RSS ソース">
          <div className="pane-title">
            <span>板一覧</span>
            <div className="pane-title-actions">
              <button onClick={() => setIsAddFeedOpen(true)} title="板を追加" type="button">+</button>
              <button onClick={deleteSelectedFeed} disabled={!selectedFeedId} title="選択中の板を削除" type="button">-</button>
            </div>
          </div>
          <div className="feed-tree">
            <div className="tree-heading">RSS</div>
            {feedList.map((feed) => (
              <button
                className={`feed-row ${feed.id === selectedFeedId ? "is-selected" : ""}`}
                key={feed.id}
                onClick={() => selectFeed(feed.id)}
                type="button"
              >
                <span className="feed-name">{feed.title}</span>
                <span className="feed-count">{feed.unreadCount}</span>
              </button>
            ))}
          </div>

          <div className="favorite-divider" />

          <div className="favorite-pane">
            <div className="pane-title favorite-title" onClick={() => setIsFavoriteCollapsed(!isFavoriteCollapsed)} style={{ cursor: "pointer", userSelect: "none" }}>
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
                        onClick={() => handleSelectFavoriteThread(thread)}
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
        </aside>

        <section
          className="content-pane"
          ref={contentPaneRef}
          style={{ "--thread-list-height": `${threadListHeight}%` } as CSSProperties}
        >
          <section
            className="thread-list-pane"
            aria-label="スレタイ一覧"
            style={
              {
                "--thread-grid-columns": threadGridColumns,
                "--thread-list-min-width": `${threadListMinWidth}px`
              } as CSSProperties
            }
          >
            <div className="toolbar">
              <div>
                <div className="pane-title">スレタイ一覧</div>
                <div className="pane-subtitle">{selectedFeed?.url ?? ""}</div>
              </div>
              <button
                className="refresh-button"
                disabled={isRefreshing || !selectedFeed}
                onClick={refreshSelectedFeed}
                type="button"
              >
                {isRefreshing ? "取得中" : "更新"}
              </button>
            </div>
            {refreshMessage ? (
              <div className={`refresh-status ${isRefreshing ? "is-loading" : ""}`}>
                <span>{refreshMessage}</span>
                {isRefreshing ? <span className="progress-blocks" aria-hidden="true" /> : null}
              </div>
            ) : null}

            <div className="thread-list-header">
              {threadColumnLabels.map((label, index) => (
                <span className="thread-header-cell" key={label}>
                  <span className="thread-header-label">{label}</span>
                  {index < threadColumnLabels.length - 1 ? (
                    <span
                      aria-label={`${label}列の幅を変更`}
                      className="column-resize-handle"
                      onMouseDown={(event) => startThreadColumnResize(index, event)}
                      role="separator"
                    />
                  ) : null}
                </span>
              ))}
            </div>
            <div className="thread-list">
              {threadList.map((thread) => (
                <button
                  className={`thread-row ${thread.id === selectedThread?.id ? "is-selected" : ""} ${
                    thread.isRead ? "is-read" : ""
                  }`}
                  key={thread.id}
                  onClick={() => setSelectedThreadId(thread.id)}
                  type="button"
                >
                  <span className="thread-title">{thread.vipTitle}</span>
                  <span className="thread-original-title">{thread.originalTitle}</span>
                  <span className="thread-count">{thread.responseCount}</span>
                  <span className="thread-source">{thread.source}</span>
                  <span className="thread-date">{formatThreadDate(thread.publishedAt)}</span>
                  <span className="thread-url">{thread.url}</span>
                </button>
              ))}
            </div>
          </section>

          <div
            aria-label="スレタイ一覧とスレ本文の境界"
            className="pane-splitter"
            onMouseDown={startVerticalResize}
            role="separator"
          />

          <section className="thread-body-pane" aria-label="スレ本文">
            {selectedThread ? (
              <section className="thread-reader-pane" aria-label="スレ本文">
                <div className="thread-header">
                  <div>
                    <div className="thread-heading">{selectedThread.vipTitle}</div>
                    <div className="original-title">元記事: {selectedThread.originalTitle}</div>
                  </div>
                  <div className="thread-header-actions" style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <button
                      className={`favorite-button ${selectedThread.isFavorite ? "is-favorite-active" : ""}`}
                      onClick={toggleFavorite}
                      type="button"
                      title={selectedThread.isFavorite ? "お気に入り解除" : "お気に入りに追加"}
                    >
                      {selectedThread.isFavorite ? "★ お気に入り解除" : "☆ お気に入り"}
                    </button>
                    {selectedThread.posts.length > 1 && !selectedThread.posts.some(p => p.isUser) ? (
                      <button
                        className="deep-dive-button"
                        onClick={() => generateResponses(true)}
                        disabled={isSelectedThreadGenerating}
                        type="button"
                      >
                        再生成
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="posts">
                  {selectedThread.posts.map((post) => {
                    const replyRegex = new RegExp(`>>${post.no}(?!\\d)`);
                    const hasReplies = selectedThread.posts.some((p) => replyRegex.test(p.body));
                    return (
                      <article className={`post ${post.isUser ? "is-user-post" : ""}`} id={`post-${post.no}`} key={`${selectedThread.id}-${post.no}`}>
                        <div className="post-meta">
                          <span
                            className={`post-no ${hasReplies ? "post-no-hoverable" : ""}`}
                            onMouseEnter={hasReplies ? (e) => handlePostNoMouseEnter(post.no, e) : undefined}
                            onMouseLeave={hasReplies ? handlePostNoMouseLeave : undefined}
                          >
                            {post.no} ：
                          </span>
                          <span className="post-name">{post.name}</span>
                          {post.mail ? <span className="post-mail">[{post.mail}]</span> : null}
                          <span className="post-date">{post.date}</span>
                          <span className="post-id">ID:{post.id}</span>
                        </div>
                        <div className="post-body">
                          <PostBody
                            body={post.body}
                            onAnchorClick={scrollToPost}
                            onAnchorMouseEnter={handleAnchorMouseEnter}
                            onAnchorMouseLeave={handleAnchorMouseLeave}
                          />
                        </div>
                      </article>
                    );
                  })}
                  {selectedThread.posts.length <= 1 && !isSelectedThreadGenerating ? (
                    <div className="thread-load-trigger">
                      <button
                        className="load-button"
                        onClick={() => generateResponses()}
                        type="button"
                      >
                        読み込む（生成）
                      </button>
                    </div>
                  ) : null}
                  {selectedThread.posts.length > 1 && !isSelectedThreadGenerating && selectedThread.posts.reduce((max, p) => Math.max(max, p.no), 0) < 1000 ? (
                    <div className="thread-load-trigger" style={{ marginTop: "12px", marginBottom: "12px", textAlign: "center" }}>
                      <button
                        className="load-button"
                        onClick={handleGenerateReplies}
                        disabled={isPosting}
                        type="button"
                      >
                        {postStatus === "generating" ? "レス生成中..." : "再読み込み(続きのレス生成)"}
                      </button>
                    </div>
                  ) : null}
                  {isSelectedThreadGenerating ? (
                    <div className="thread-response-loading">
                      <span>レス生成中...</span>
                      <span className="progress-blocks" aria-hidden="true" />
                    </div>
                  ) : null}
                </div>
                {selectedThread.posts.length > 1 ? (
                  <form className="write-panel" onSubmit={handlePostMessage}>
                    <div className="write-meta-row">
                      <label htmlFor="reply-name">名前:</label>
                      <input
                        id="reply-name"
                        type="text"
                        value={replyName}
                        onChange={(e) => setReplyName(e.target.value)}
                        placeholder="省略可"
                        disabled={isPosting || selectedThread.posts.length >= 1000}
                      />
                      <label htmlFor="reply-mail">E-mail:</label>
                      <input
                        id="reply-mail"
                        type="text"
                        value={replyMail}
                        onChange={(e) => setReplyMail(e.target.value)}
                        placeholder="sage"
                        disabled={isPosting || selectedThread.posts.length >= 1000}
                      />
                      {selectedThread.posts.length >= 1000 ? (
                        <span className="thread-closed-msg">このスレッドは1000レスに達したため書き込めません。</span>
                      ) : (
                        <button
                          type="submit"
                          className="post-submit-btn"
                          disabled={isPosting || !replyBody.trim()}
                        >
                          {postStatus === "writing"
                            ? "書き込み中..."
                            : postStatus === "generating"
                            ? "レス生成中..."
                            : isPosting
                            ? "送信中..."
                            : "書き込む"}
                        </button>
                      )}
                    </div>
                    <div className="write-body-row">
                      <textarea
                        id="reply-body"
                        value={replyBody}
                        onChange={(e) => setReplyBody(e.target.value)}
                        placeholder={selectedThread.posts.length >= 1000 ? "書き込み限界です" : "本文（Ctrl+Enterで書き込み）"}
                        disabled={isPosting || selectedThread.posts.length >= 1000}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                            void handlePostMessage(e);
                          }
                        }}
                      />
                    </div>
                    {postError && <div className="write-error-msg">{postError}</div>}
                  </form>
                ) : null}
              </section>
            ) : (
              <div className="empty-state">記事がありません。RSSを選んで更新してください。</div>
            )}
          </section>
        </section>
      </div>

      {isStatisticsOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="statistics-modal" aria-label="統計情報" role="dialog">
            <div className="modal-title-bar">
              <span>統計情報</span>
              <button className="modal-close-button" onClick={() => setIsStatisticsOpen(false)} type="button">
                x
              </button>
            </div>
            <div className="modal-menu-strip">
              <span>API統計</span>
              <span>RSS統計</span>
            </div>
            <div className="statistics-content">
              {isStatisticsLoading ? (
                <div className="stats-loading">
                  <span>読み込み中...</span>
                  <span className="progress-blocks" aria-hidden="true" />
                </div>
              ) : statistics ? (
                <>
                  <section className="stats-section">
                    <div className="stats-section-title">API統計</div>
                    <div className="stats-grid">
                      <StatCell label="APIログ" value={statistics.api.totalLogs} />
                      <StatCell label="呼び出し回数" value={statistics.api.requestCount} />
                      <StatCell label="成功" value={statistics.api.successLogs} />
                      <StatCell label="失敗" value={statistics.api.errorLogs} />
                      <StatCell label="スキップ" value={statistics.api.skippedLogs} />
                      <StatCell label="対象件数" value={statistics.api.itemCount} />
                      <StatCell label="Prompt文字" value={statistics.api.promptChars} />
                      <StatCell label="Response文字" value={statistics.api.responseChars} />
                      <StatCell label="Prompt token" value={statistics.api.promptTokenCount} />
                      <StatCell label="Output token" value={statistics.api.candidatesTokenCount} />
                      <StatCell label="Total token" value={statistics.api.totalTokenCount} />
                      <StatCell label="最終実行" value={formatStatsDate(statistics.api.lastFinishedAt)} />
                    </div>
                  </section>

                  <section className="stats-section">
                    <div className="stats-section-title">RSS統計</div>
                    <div className="stats-grid">
                      <StatCell label="更新回数" value={statistics.rss.totalRuns} />
                      <StatCell label="成功" value={statistics.rss.successRuns} />
                      <StatCell label="失敗" value={statistics.rss.errorRuns} />
                      <StatCell label="取得件数" value={statistics.rss.fetchedCount} />
                      <StatCell label="新規" value={statistics.rss.insertedCount} />
                      <StatCell label="更新" value={statistics.rss.updatedCount} />
                      <StatCell label="既存" value={statistics.rss.skippedCount} />
                      <StatCell label="変換" value={statistics.rss.convertedCount} />
                      <StatCell label="変換失敗" value={statistics.rss.conversionFailedCount} />
                      <StatCell label="未変換" value={statistics.rss.conversionSkippedCount} />
                      <StatCell label="最終実行" value={formatStatsDate(statistics.rss.lastFinishedAt)} />
                    </div>
                  </section>

                  <section className="stats-section">
                    <div className="stats-section-title">最近のAPIログ</div>
                    <div className="stats-table api-log-table">
                      <span>日時</span>
                      <span>状態</span>
                      <span>件数</span>
                      <span>Token</span>
                      <span>モデル</span>
                      {statistics.recentApiRequests.map((request) => (
                        <ApiLogRow key={request.id} request={request} />
                      ))}
                    </div>
                  </section>

                  <section className="stats-section">
                    <div className="stats-section-title">最近のRSSログ</div>
                    <div className="stats-table rss-log-table">
                      <span>日時</span>
                      <span>状態</span>
                      <span>取得</span>
                      <span>新規/更新</span>
                      <span>変換</span>
                      {statistics.recentRssRuns.map((run) => (
                        <RssLogRow key={run.id} run={run} />
                      ))}
                    </div>
                  </section>

                  <section className="stats-section">
                    <div className="stats-section-title">最近の元記事取得ログ</div>
                    <div className="stats-table article-fetch-log-table">
                      <span>日時</span>
                      <span>状態</span>
                      <span>URL</span>
                      <span>Robots.txt</span>
                      <span>サイズ</span>
                      <span>時間</span>
                      {statistics.recentArticleFetches.map((fetch) => (
                        <ArticleFetchLogRow key={fetch.id} fetch={fetch} />
                      ))}
                    </div>
                  </section>
                </>
              ) : (
                <div className="empty-state">統計情報を取得できませんでした。</div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {isResidentPromptsOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="resident-prompts-modal" aria-label="住民設定" role="dialog">
            <div className="modal-title-bar">
              <span>住民設定（板ごとのカスタムプロンプト）</span>
              <button className="modal-close-button" onClick={() => setIsResidentPromptsOpen(false)} type="button">
                x
              </button>
            </div>
            <div className="modal-content">
              <div className="form-group">
                <label htmlFor="prompt-feed-select">対象の板:</label>
                <select
                  id="prompt-feed-select"
                  value={promptTargetFeedId}
                  onChange={(e) => setPromptTargetFeedId(e.target.value)}
                  className="feed-select"
                  disabled={isPromptLoading}
                >
                  {feedList.map((feed) => (
                    <option key={feed.id} value={feed.id}>
                      {feed.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group flex-grow">
                <label htmlFor="prompt-text-textarea">住民プロンプト（スレのレス生成時のカスタム指示）:</label>
                <textarea
                  id="prompt-text-textarea"
                  value={promptText}
                  onChange={(e) => setPromptText(e.target.value)}
                  placeholder="例：このスレの住民はメンバー愛に溢れ、ヌクモリティが高く、お互いを肯定しあうほのぼのした雰囲気です。叩きや煽りは禁止。"
                  className="prompt-textarea"
                  disabled={isPromptLoading}
                />
              </div>

              {promptStatusMessage ? (
                <div className="prompt-status-message">
                  {promptStatusMessage}
                </div>
              ) : null}

              <div className="modal-buttons">
                <button
                  onClick={savePrompt}
                  className="btn"
                  disabled={isPromptLoading || !promptTargetFeedId}
                  type="button"
                >
                  保存
                </button>
                <button
                  onClick={clearPrompt}
                  className="btn"
                  disabled={isPromptLoading || !promptTargetFeedId}
                  type="button"
                >
                  デフォルトに戻す
                </button>
                <button
                  onClick={() => setIsResidentPromptsOpen(false)}
                  className="btn"
                  type="button"
                >
                  閉じる
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {isAddFeedOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section className="add-feed-modal" aria-label="板を追加する" role="dialog">
            <div className="modal-title-bar">
              <span>板の追加（RSSの登録）</span>
              <button className="modal-close-button" onClick={() => setIsAddFeedOpen(false)} type="button">
                x
              </button>
            </div>
            <div className="modal-content">
              <div className="form-group">
                <label htmlFor="add-feed-title-input">板の名前（タイトル）:</label>
                <input
                  id="add-feed-title-input"
                  type="text"
                  value={addFeedTitle}
                  onChange={(e) => setAddFeedTitle(e.target.value)}
                  placeholder="例：はてなブックマークIT"
                  className="form-input"
                  disabled={isAddFeedLoading}
                />
              </div>
              <div className="form-group">
                <label htmlFor="add-feed-url-input">RSS フィード URL:</label>
                <input
                  id="add-feed-url-input"
                  type="text"
                  value={addFeedUrl}
                  onChange={(e) => setAddFeedUrl(e.target.value)}
                  placeholder="例：https://b.hatena.ne.jp/hotentry/it.rss"
                  className="form-input"
                  disabled={isAddFeedLoading}
                />
              </div>

              {addFeedError ? (
                <div className="prompt-status-message text-error" style={{ color: "#ff0000", marginTop: "8px" }}>
                  {addFeedError}
                </div>
              ) : null}

              <div className="modal-buttons">
                <button
                  onClick={addFeed}
                  className="btn"
                  disabled={isAddFeedLoading || !addFeedTitle.trim() || !addFeedUrl.trim()}
                  type="button"
                >
                  追加
                </button>
                <button
                  onClick={() => setIsAddFeedOpen(false)}
                  className="btn"
                  disabled={isAddFeedLoading}
                  type="button"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {popupData ? (
        <div
          className="reply-popup"
          style={popupData.style}
          onMouseEnter={clearPopupTimeout}
          onMouseLeave={handleMouseLeaveWithDelay}
        >
          <div className="reply-popup-title">{popupData.title}</div>
          {popupData.posts.map((post) => (
            <article className={`post ${post.isUser ? "is-user-post" : ""}`} key={`popup-${post.no}`}>
              <div className="post-meta">
                <span className="post-no">{post.no} ：</span>
                <span className="post-name">{post.name}</span>
                {post.mail ? <span className="post-mail">[{post.mail}]</span> : null}
                <span className="post-date">{post.date}</span>
                <span className="post-id">ID:{post.id}</span>
              </div>
              <div className="post-body">
                <PostBody body={post.body} onAnchorClick={scrollToPost} />
              </div>
            </article>
          ))}
        </div>
      ) : null}
    </main>
  );
}

function StatCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-cell">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{typeof value === "number" ? value.toLocaleString() : value}</span>
    </div>
  );
}

function PostBody({
  body,
  onAnchorClick,
  onAnchorMouseEnter,
  onAnchorMouseLeave
}: {
  body: string;
  onAnchorClick: (no: number) => void;
  onAnchorMouseEnter?: (no: number, event: ReactMouseEvent<HTMLElement>) => void;
  onAnchorMouseLeave?: () => void;
}) {
  return (
    <>
      {splitBody(body).map((part, index) => {
        if (part.type === "url") {
          return (
            <button className="post-link" key={`${part.value}-${index}`} onClick={() => openPostUrl(part.value)} type="button">
              {part.value}
            </button>
          );
        }
        if (part.type === "anchor") {
          const postNo = parseInt(part.value.replace(">>", ""), 10);
          return (
            <button
              className="post-link"
              key={`${part.value}-${index}`}
              onClick={() => onAnchorClick(postNo)}
              onMouseEnter={(e) => onAnchorMouseEnter?.(postNo, e)}
              onMouseLeave={onAnchorMouseLeave}
              type="button"
            >
              {part.value}
            </button>
          );
        }
        return <span key={`${part.value}-${index}`}>{part.value}</span>;
      })}
    </>
  );
}

function splitBody(body: string): Array<{ type: "text" | "url" | "anchor"; value: string }> {
  const parts: Array<{ type: "text" | "url" | "anchor"; value: string }> = [];
  const pattern = /(https?:\/\/[^\s<>"']+)|(>>\d+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: body.slice(lastIndex, match.index) });
    }

    const matchedStr = match[0];
    if (matchedStr.startsWith(">>")) {
      parts.push({ type: "anchor", value: matchedStr });
    } else {
      const { url, trailingText } = trimTrailingUrlPunctuation(matchedStr);
      parts.push({ type: "url", value: url });
      if (trailingText) {
        parts.push({ type: "text", value: trailingText });
      }
    }
    lastIndex = match.index + matchedStr.length;
  }

  if (lastIndex < body.length) {
    parts.push({ type: "text", value: body.slice(lastIndex) });
  }

  return parts;
}

function trimTrailingUrlPunctuation(value: string): { url: string; trailingText: string } {
  const url = value.replace(/[),.。]+$/g, "");
  return {
    url,
    trailingText: value.slice(url.length)
  };
}

function openPostUrl(url: string) {
  void window.viperReader?.openExternalUrl(url);
}

function ApiLogRow({ request }: { request: StatisticsSummary["recentApiRequests"][number] }) {
  return (
    <>
      <span>{formatStatsDate(request.finishedAt)}</span>
      <span>{formatStatus(request.status)}</span>
      <span>{request.itemCount}</span>
      <span>{request.totalTokenCount ?? "-"}</span>
      <span>{request.model}</span>
    </>
  );
}

function RssLogRow({ run }: { run: StatisticsSummary["recentRssRuns"][number] }) {
  return (
    <>
      <span>{formatStatsDate(run.finishedAt)}</span>
      <span>{formatStatus(run.status)}</span>
      <span>{run.fetchedCount}</span>
      <span>
        {run.insertedCount}/{run.updatedCount}
      </span>
      <span>{run.convertedCount}</span>
    </>
  );
}

function ArticleFetchLogRow({ fetch }: { fetch: StatisticsSummary["recentArticleFetches"][number] }) {
  const sizeKb = fetch.contentSize > 0 ? (fetch.contentSize / 1024).toFixed(1) : "-";
  return (
    <>
      <span>{formatStatsDate(fetch.fetchedAt)}</span>
      <span className={fetch.status === "error" ? "text-error" : ""}>
        {fetch.status === "success" ? "成功" : "失敗"}
      </span>
      <span className="text-left-align" title={fetch.url}>
        {fetch.url}
      </span>
      <span>{fetch.robotsResult}</span>
      <span>{sizeKb} KB</span>
      <span>{fetch.elapsedMs} ms</span>
    </>
  );
}

function formatStatus(status: string): string {
  if (status === "success") {
    return "成功";
  }
  if (status === "error") {
    return "失敗";
  }
  if (status === "skipped") {
    return "スキップ";
  }
  return status;
}

function formatStatsDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  return formatThreadDate(value);
}

function formatThreadDate(value: string): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}
