import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

const defaultThreadColumnWidths = [44, 360, 180, 170, 300, 54, 126, 260];
const minThreadColumnWidths = [44, 220, 100, 100, 180, 44, 96, 140];

export function parseThreadColumnWidths(v4Json: string | null, v3Json: string | null, v2Json: string | null): number[] | null {
  function parse(json: string | null): unknown {
    if (!json) return null;
    try {
      return JSON.parse(json) as unknown;
    } catch {
      return null;
    }
  }

  function normalize(widths: unknown[]): number[] {
    return widths.map((width, index) =>
      typeof width === "number" && Number.isFinite(width)
        ? Math.max(minThreadColumnWidths[index], width)
        : defaultThreadColumnWidths[index]
    );
  }

  const v4 = parse(v4Json);
  if (Array.isArray(v4) && v4.length === defaultThreadColumnWidths.length) return normalize(v4);

  function migrate(widths: unknown[]): number[] {
    return normalize([...widths.slice(0, 2), defaultThreadColumnWidths[2], ...widths.slice(2)]);
  }

  const v3 = parse(v3Json);
  if (Array.isArray(v3) && v3.length === 7) return migrate(v3);

  const v2 = parse(v2Json);
  if (Array.isArray(v2)) {
    const migrated = v2.length === 6
      ? [defaultThreadColumnWidths[0], ...v2]
      : v2;
    if (migrated.length === 7) return migrate(migrated);
  }
  return null;
}

export type PaneLayout = "stacked" | "horizontal";

export function parsePaneLayout(value: string | null): PaneLayout {
  return value === "horizontal" ? "horizontal" : "stacked";
}

export function parseThreadListWidth(value: string | null): number {
  const width = value === null || !value.trim() ? NaN : Number(value);
  return Number.isFinite(width) ? Math.min(65, Math.max(25, width)) : 40;
}

export function normalizeArticlePaneWidth(width: number): number {
  return Number.isFinite(width) ? Math.min(640, Math.max(80, width)) : 360;
}

export function getArticlePaneResizeWidth(width: number, layout: PaneLayout, containerWidth: number): number {
  const maxWidth = layout === "horizontal"
    ? normalizeArticlePaneWidth(containerWidth / 2)
    : Math.max(260, Math.min(640, containerWidth - 420));
  const minWidth = layout === "horizontal" ? Math.min(260, Math.max(80, maxWidth / 2)) : 260;
  return normalizeArticlePaneWidth(Math.min(maxWidth, Math.max(minWidth, width)));
}

export function usePaneLayout() {
  const [paneLayout, setPaneLayoutState] = useState<PaneLayout>("stacked");
  const [layoutError, setLayoutError] = useState("");
  const [isLayoutSaving, setIsLayoutSaving] = useState(false);
  const [threadListWidthPercent, setThreadListWidthPercent] = useState(40);
  const [threadListHeight, setThreadListHeight] = useState(42);
  const [feedPaneWidth, setFeedPaneWidth] = useState(248);
  const [feedTreeHeight, setFeedTreeHeight] = useState(300);
  const [articlePaneWidth, setArticlePaneWidth] = useState(360);
  const [isArticlePaneVisible, setIsArticlePaneVisible] = useState(false);
  const [isWritePanelVisible, setIsWritePanelVisible] = useState(true);
  const [threadColumnWidths, setThreadColumnWidths] = useState(defaultThreadColumnWidths);
  const appShellRef = useRef<HTMLDivElement>(null);
  const contentPaneRef = useRef<HTMLElement>(null);
  const threadContentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!window.viperReader) return;

    void Promise.all([
      window.viperReader.getUserSetting("threadListHeight"),
      window.viperReader.getUserSetting("threadColumnWidthsV4"),
      window.viperReader.getUserSetting("threadColumnWidthsV3"),
      window.viperReader.getUserSetting("threadColumnWidthsV2"),
      window.viperReader.getUserSetting("feedPaneWidth"),
      window.viperReader.getUserSetting("feedTreeHeight"),
      window.viperReader.getUserSetting("articlePaneWidth"),
      window.viperReader.getUserSetting("articlePaneVisible"),
      window.viperReader.getUserSetting("writePanelVisible"),
      window.viperReader.getUserSetting("paneLayout"),
      window.viperReader.getUserSetting("threadListWidthPercent")
    ]).then(([height, widthsV4Json, widthsV3Json, widthsV2Json, savedFeedPaneWidth, savedFeedTreeHeight, savedArticlePaneWidth, savedArticlePaneVisible, savedWritePanelVisible, savedPaneLayout, savedThreadListWidth]) => {
      setPaneLayoutState(parsePaneLayout(savedPaneLayout));
      setThreadListWidthPercent(parseThreadListWidth(savedThreadListWidth));
      if (height) setThreadListHeight(Number.parseFloat(height));
      if (savedFeedPaneWidth) {
        const width = Number.parseFloat(savedFeedPaneWidth);
        if (Number.isFinite(width)) setFeedPaneWidth(Math.min(480, Math.max(180, width)));
      }
      if (savedFeedTreeHeight) {
        const nextHeight = Number.parseFloat(savedFeedTreeHeight);
        if (Number.isFinite(nextHeight)) setFeedTreeHeight(Math.max(100, nextHeight));
      }
      const savedWidths = parseThreadColumnWidths(widthsV4Json, widthsV3Json, widthsV2Json);
      if (savedWidths) {
        setThreadColumnWidths(savedWidths);
        if (widthsV4Json !== JSON.stringify(savedWidths)) {
          void window.viperReader?.saveUserSetting("threadColumnWidthsV4", JSON.stringify(savedWidths));
        }
      }
      if (savedArticlePaneWidth) {
        const width = Number.parseFloat(savedArticlePaneWidth);
        setArticlePaneWidth(normalizeArticlePaneWidth(width));
      }
      setIsArticlePaneVisible(savedArticlePaneVisible === "true");
      setIsWritePanelVisible(savedWritePanelVisible !== "false");
    }).catch((error) => {
      console.error("ペイン設定の読込に失敗しました:", error);
    });
  }, []);

  async function setPaneLayout(next: PaneLayout) {
    if (isLayoutSaving) return;
    const previous = paneLayout;
    setPaneLayoutState(next);
    setLayoutError("");
    setIsLayoutSaving(true);
    try {
      await window.viperReader?.saveUserSetting("paneLayout", next);
    } catch (error) {
      setPaneLayoutState(previous);
      setLayoutError(error instanceof Error ? error.message : "ペイン配置の保存に失敗しました。");
    } finally {
      setIsLayoutSaving(false);
    }
  }

  function startHorizontalResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const contentPane = contentPaneRef.current;
    if (!contentPane) return;
    const rect = contentPane.getBoundingClientRect();
    let currentWidth = threadListWidthPercent;
    function handleMouseMove(moveEvent: MouseEvent) {
      currentWidth = parseThreadListWidth(String(((moveEvent.clientX - rect.left) / rect.width) * 100));
      setThreadListWidthPercent(currentWidth);
    }
    function stopResize() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", stopResize);
      document.body.classList.remove("is-column-resizing");
      void window.viperReader?.saveUserSetting("threadListWidthPercent", String(currentWidth));
    }
    document.body.classList.add("is-column-resizing");
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", stopResize);
  }

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
      void window.viperReader?.saveUserSetting("threadColumnWidthsV4", JSON.stringify(currentWidths));
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
      currentWidth = getArticlePaneResizeWidth(rect.right - moveEvent.clientX, paneLayout, rect.width);
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

  function setWritePanelVisible(visible: boolean) {
    setIsWritePanelVisible(visible);
    void window.viperReader?.saveUserSetting("writePanelVisible", String(visible));
  }

  function toggleWritePanel() {
    setWritePanelVisible(!isWritePanelVisible);
  }

  return {
    paneLayout,
    setPaneLayout,
    layoutError,
    isLayoutSaving,
    threadListWidthPercent,
    startHorizontalResize,
    appShellRef,
    contentPaneRef,
    threadContentRef,
    threadListHeight,
    feedPaneWidth,
    feedTreeHeight,
    articlePaneWidth,
    isArticlePaneVisible,
    isWritePanelVisible,
    threadGridColumns: threadColumnWidths.map((width) => `${width}px`).join(" "),
    threadListMinWidth: threadColumnWidths.reduce((total, width) => total + width, 0),
    startVerticalResize,
    startFeedPaneResize,
    startFeedTreeResize,
    startThreadColumnResize,
    startArticlePaneResize,
    toggleArticlePane,
    setWritePanelVisible,
    toggleWritePanel
  };
}
