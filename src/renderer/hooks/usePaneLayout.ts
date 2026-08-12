import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

const defaultThreadColumnWidths = [44, 360, 170, 300, 54, 126, 260];
const minThreadColumnWidths = [44, 220, 100, 180, 44, 96, 140];

function parseThreadColumnWidths(v3Json: string | null, v2Json: string | null): number[] | null {
  function parse(json: string | null): unknown {
    if (!json) return null;
    try {
      return JSON.parse(json) as unknown;
    } catch {
      return null;
    }
  }

  const v3 = parse(v3Json);
  if (Array.isArray(v3) && v3.length === defaultThreadColumnWidths.length) {
    return v3.map((width, index) =>
      typeof width === "number" && Number.isFinite(width)
        ? Math.max(minThreadColumnWidths[index], width)
        : defaultThreadColumnWidths[index]
    );
  }

  const v2 = parse(v2Json);
  if (Array.isArray(v2)) {
    const migrated = v2.length === defaultThreadColumnWidths.length - 1
      ? [defaultThreadColumnWidths[0], ...v2]
      : v2;
    if (migrated.length === defaultThreadColumnWidths.length) {
      return migrated.map((width, index) =>
        typeof width === "number" && Number.isFinite(width)
          ? Math.max(minThreadColumnWidths[index], width)
          : defaultThreadColumnWidths[index]
      );
    }
  }
  return null;
}

export function usePaneLayout() {
  const [threadListHeight, setThreadListHeight] = useState(42);
  const [feedPaneWidth, setFeedPaneWidth] = useState(248);
  const [feedTreeHeight, setFeedTreeHeight] = useState(300);
  const [articlePaneWidth, setArticlePaneWidth] = useState(360);
  const [isArticlePaneVisible, setIsArticlePaneVisible] = useState(false);
  const [threadColumnWidths, setThreadColumnWidths] = useState(defaultThreadColumnWidths);
  const appShellRef = useRef<HTMLDivElement>(null);
  const contentPaneRef = useRef<HTMLElement>(null);
  const threadContentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!window.viperReader) return;

    void Promise.all([
      window.viperReader.getUserSetting("threadListHeight"),
      window.viperReader.getUserSetting("threadColumnWidthsV3"),
      window.viperReader.getUserSetting("threadColumnWidthsV2"),
      window.viperReader.getUserSetting("feedPaneWidth"),
      window.viperReader.getUserSetting("feedTreeHeight"),
      window.viperReader.getUserSetting("articlePaneWidth"),
      window.viperReader.getUserSetting("articlePaneVisible")
    ]).then(([height, widthsV3Json, widthsV2Json, savedFeedPaneWidth, savedFeedTreeHeight, savedArticlePaneWidth, savedArticlePaneVisible]) => {
      if (height) setThreadListHeight(Number.parseFloat(height));
      if (savedFeedPaneWidth) {
        const width = Number.parseFloat(savedFeedPaneWidth);
        if (Number.isFinite(width)) setFeedPaneWidth(Math.min(480, Math.max(180, width)));
      }
      if (savedFeedTreeHeight) {
        const nextHeight = Number.parseFloat(savedFeedTreeHeight);
        if (Number.isFinite(nextHeight)) setFeedTreeHeight(Math.max(100, nextHeight));
      }
      const savedWidths = parseThreadColumnWidths(widthsV3Json, widthsV2Json);
      if (savedWidths) {
        setThreadColumnWidths(savedWidths);
        if (!widthsV3Json) {
          void window.viperReader?.saveUserSetting("threadColumnWidthsV3", JSON.stringify(savedWidths));
        }
      }
      if (savedArticlePaneWidth) {
        const width = Number.parseFloat(savedArticlePaneWidth);
        if (Number.isFinite(width)) setArticlePaneWidth(Math.min(640, Math.max(260, width)));
      }
      setIsArticlePaneVisible(savedArticlePaneVisible === "true");
    }).catch((error) => {
      console.error("ペイン設定の読込に失敗しました:", error);
    });
  }, []);

  function startVerticalResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const contentPane = contentPaneRef.current;
    if (!contentPane) return;
    const rect = contentPane.getBoundingClientRect();
    let currentHeight = threadListHeight;
    function handleMouseMove(moveEvent: MouseEvent) {
      currentHeight = Math.min(72, Math.max(24, ((moveEvent.clientY - rect.top) / rect.height) * 100));
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
    if (!appShell) return;
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

  function startFeedTreeResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const feedPane = appShellRef.current?.querySelector<HTMLElement>(".feed-pane");
    const feedTree = feedPane?.querySelector<HTMLElement>(".feed-tree");
    const favoritePane = feedPane?.querySelector<HTMLElement>(".favorite-pane");
    if (!feedPane || !feedTree || !favoritePane) return;
    const treeRect = feedTree.getBoundingClientRect();
    const availableHeight = treeRect.height + favoritePane.getBoundingClientRect().height;
    let currentHeight = feedTreeHeight;
    function handleMouseMove(moveEvent: MouseEvent) {
      currentHeight = Math.min(Math.max(100, availableHeight - 100), Math.max(100, moveEvent.clientY - treeRect.top));
      setFeedTreeHeight(currentHeight);
    }
    function stopResize() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.classList.remove("is-feed-tree-resizing");
      void window.viperReader?.saveUserSetting("feedTreeHeight", currentHeight.toString());
    }
    document.body.classList.add("is-feed-tree-resizing");
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
      currentWidths = [...startWidths];
      currentWidths[columnIndex] = Math.max(minThreadColumnWidths[columnIndex], startWidths[columnIndex] + moveEvent.clientX - startX);
      setThreadColumnWidths(currentWidths);
    }
    function stopResize() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.classList.remove("is-column-resizing");
      void window.viperReader?.saveUserSetting("threadColumnWidthsV3", JSON.stringify(currentWidths));
    }
    document.body.classList.add("is-column-resizing");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
  }

  function startArticlePaneResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const container = threadContentRef.current;
    if (!container) return;
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

  return {
    appShellRef,
    contentPaneRef,
    threadContentRef,
    threadListHeight,
    feedPaneWidth,
    feedTreeHeight,
    articlePaneWidth,
    isArticlePaneVisible,
    threadGridColumns: threadColumnWidths.map((width) => `${width}px`).join(" "),
    threadListMinWidth: threadColumnWidths.reduce((total, width) => total + width, 0),
    startVerticalResize,
    startFeedPaneResize,
    startFeedTreeResize,
    startThreadColumnResize,
    startArticlePaneResize,
    toggleArticlePane
  };
}
