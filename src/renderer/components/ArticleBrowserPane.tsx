import { useEffect, useRef, useState } from "react";
import type {
  ArticleBrowserBounds,
  ArticleBrowserState,
  ThreadDetail
} from "../../shared/types";

type ArticleBrowserPaneProps = {
  selectedThread: ThreadDetail | null;
  isActive: boolean;
  isSuspended: boolean;
  onShowReplies: () => void;
  onShowSplitView: () => void;
  isSplitView: boolean;
};

const initialState: ArticleBrowserState = {
  threadId: null,
  url: "",
  title: "",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  blockerStatus: "initializing",
  error: null
};

export function ArticleBrowserPane({
  selectedThread,
  isActive,
  isSuspended,
  onShowReplies,
  onShowSplitView,
  isSplitView
}: ArticleBrowserPaneProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [browserState, setBrowserState] = useState<ArticleBrowserState>(initialState);
  const [unprotectedThreadId, setUnprotectedThreadId] = useState<string | null>(null);
  const allowUnprotected = selectedThread?.id === unprotectedThreadId;

  useEffect(() => {
    if (!window.viperReader) {
      return;
    }
    void window.viperReader.getArticleBrowserState().then(setBrowserState);
    return window.viperReader.onArticleBrowserState(setBrowserState);
  }, []);

  useEffect(() => {
    if (!window.viperReader) {
      return;
    }
    if (!isActive || isSuspended || !selectedThread) {
      void window.viperReader.hideArticleBrowser();
      return;
    }

    const frame = requestAnimationFrame(() => {
      const bounds = getElementBounds(viewportRef.current);
      if (!bounds || !window.viperReader || !selectedThread) {
        return;
      }
      void window.viperReader.showArticleBrowser({
        threadId: selectedThread.id,
        url: selectedThread.url,
        bounds,
        allowUnprotected
      }).then(setBrowserState);
    });
    return () => cancelAnimationFrame(frame);
  }, [isActive, isSuspended, selectedThread?.id, selectedThread?.url, allowUnprotected]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !window.viperReader) {
      return;
    }

    const updateBounds = () => {
      const bounds = getElementBounds(viewport);
      if (bounds && isActive && !isSuspended) {
        void window.viperReader?.setArticleBrowserBounds(bounds);
      }
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(viewport);
    window.addEventListener("resize", updateBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBounds);
    };
  }, [isActive, isSuspended]);

  useEffect(() => () => {
    void window.viperReader?.hideArticleBrowser();
  }, []);

  const isUnavailable = browserState.blockerStatus === "unavailable";
  const isInitializing = browserState.blockerStatus === "initializing";
  const isBlockingDisabled = browserState.blockerStatus === "disabled-for-site";
  const showProtectionGate = isUnavailable && !allowUnprotected && selectedThread?.url.startsWith("https:");

  return (
    <section className="article-browser-pane" aria-label="元記事ブラウザ">
      <div className="article-browser-toolbar">
        <button onClick={onShowReplies} type="button">レス表示</button>
        <button disabled={isSplitView} onClick={onShowSplitView} type="button">半々</button>
        <span className="article-browser-separator" aria-hidden="true" />
        <button
          disabled={!browserState.canGoBack}
          onClick={() => void window.viperReader?.articleBrowserBack()}
          title="戻る"
          type="button"
        >
          ◀
        </button>
        <button
          disabled={!browserState.canGoForward}
          onClick={() => void window.viperReader?.articleBrowserForward()}
          title="進む"
          type="button"
        >
          ▶
        </button>
        <button
          disabled={!browserState.url}
          onClick={() => void window.viperReader?.reloadArticleBrowser()}
          title="再読込"
          type="button"
        >
          ↻
        </button>
        <input
          aria-label="現在のURL"
          className="article-browser-url"
          readOnly
          title={browserState.url}
          value={browserState.url}
        />
        <button
          className={`article-browser-shield blocker-${browserState.blockerStatus}`}
          disabled={isInitializing || isUnavailable}
          onClick={() => void window.viperReader
            ?.setArticleBrowserBlockingEnabled(isBlockingDisabled)
            .then(setBrowserState)}
          title={isBlockingDisabled ? "このサイトの広告・追跡ブロックを有効にする" : "このサイトでは一時的にブロックを解除する"}
          type="button"
        >
          {blockerLabel(browserState.blockerStatus)}
        </button>
        <button
          disabled={!browserState.url}
          onClick={() => void window.viperReader?.openArticleBrowserExternally()}
          type="button"
        >
          外部で開く
        </button>
      </div>

      {browserState.error && !showProtectionGate ? (
        <div className="article-browser-notice is-error" role="alert">{browserState.error}</div>
      ) : null}

      <div className="article-browser-viewport" ref={viewportRef}>
        {!selectedThread ? (
          <div className="article-browser-placeholder">記事を選択してください。</div>
        ) : isSuspended ? (
          <div className="article-browser-placeholder">ダイアログを閉じると元記事を再表示します。</div>
        ) : isInitializing ? (
          <div className="article-browser-placeholder">
            <span>広告・追跡フィルターを準備しています...</span>
            <span className="progress-blocks" aria-hidden="true" />
          </div>
        ) : showProtectionGate ? (
          <div className="article-browser-placeholder protection-warning">
            <strong>広告・追跡フィルターを準備できませんでした。</strong>
            <span>保護なしで開くと、広告やトラッカーへ通信する可能性があります。</span>
            <div>
              <button onClick={() => void window.viperReader?.retryArticleBrowserBlocker()} type="button">
                フィルターを再試行
              </button>
              <button onClick={() => setUnprotectedThreadId(selectedThread.id)} type="button">
                保護なしでこの記事を開く
              </button>
              <button onClick={() => void window.viperReader?.openArticleBrowserExternally()} type="button">
                外部ブラウザで開く
              </button>
            </div>
          </div>
        ) : browserState.error ? (
          <div className="article-browser-placeholder">
            <strong>元記事を表示できません。</strong>
            <span>{browserState.error}</span>
            <button onClick={() => void window.viperReader?.openArticleBrowserExternally()} type="button">
              外部ブラウザで開く
            </button>
          </div>
        ) : browserState.isLoading ? (
          <div className="article-browser-placeholder is-loading">
            <span>元記事を読み込んでいます...</span>
            <span className="progress-blocks" aria-hidden="true" />
          </div>
        ) : null}
      </div>
    </section>
  );
}

function getElementBounds(element: HTMLElement | null): ArticleBrowserBounds | null {
  if (!element) {
    return null;
  }
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) {
    return null;
  }
  return {
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height
  };
}

function blockerLabel(status: ArticleBrowserState["blockerStatus"]): string {
  switch (status) {
    case "active":
      return "🛡 遮断中";
    case "disabled-for-site":
      return "⚠ 解除中";
    case "unavailable":
      return "⚠ 保護なし";
    default:
      return "🛡 準備中";
  }
}
