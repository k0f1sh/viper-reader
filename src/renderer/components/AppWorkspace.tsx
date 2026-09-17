import type { ComponentProps, MouseEventHandler, RefObject } from "react";
import { ArticleBodyPane } from "./ArticleBodyPane";
import { ArticleBrowserPane } from "./ArticleBrowserPane";
import { FeedPane } from "./FeedPane";
import { MenuBar } from "./MenuBar";
import { ThreadListPane } from "./ThreadListPane";
import { ThreadReaderPane } from "./ThreadReaderPane";

type AppWorkspaceProps = {
  menu: ComponentProps<typeof MenuBar>;
  feedPane: ComponentProps<typeof FeedPane>;
  threadList: ComponentProps<typeof ThreadListPane>;
  articleBrowser: ComponentProps<typeof ArticleBrowserPane>;
  threadReader: ComponentProps<typeof ThreadReaderPane>;
  articleBody: ComponentProps<typeof ArticleBodyPane>;
  threadViewMode: "replies" | "browser";
  isArticleBrowserExpanded: boolean;
  showArticlePane: boolean;
  feedPaneWidth: number;
  threadListHeight: number;
  articlePaneWidth: number;
  appShellRef: RefObject<HTMLDivElement | null>;
  contentPaneRef: RefObject<HTMLElement | null>;
  threadContentRef: RefObject<HTMLElement | null>;
  onStartFeedPaneResize: MouseEventHandler<HTMLDivElement>;
  onStartVerticalResize: MouseEventHandler<HTMLDivElement>;
  onStartArticlePaneResize: MouseEventHandler<HTMLDivElement>;
};

export function AppWorkspace({
  menu,
  feedPane,
  threadList,
  articleBrowser,
  threadReader,
  articleBody,
  threadViewMode,
  isArticleBrowserExpanded,
  showArticlePane,
  feedPaneWidth,
  threadListHeight,
  articlePaneWidth,
  appShellRef,
  contentPaneRef,
  threadContentRef,
  onStartFeedPaneResize,
  onStartVerticalResize,
  onStartArticlePaneResize
}: AppWorkspaceProps) {
  if (threadViewMode === "browser" && isArticleBrowserExpanded) {
    return (
      <div className="article-browser-expanded">
        <ArticleBrowserPane {...articleBrowser} />
      </div>
    );
  }

  return (
    <>
      <MenuBar {...menu} />
      <div className="app-shell" ref={appShellRef} style={{ "--feed-pane-width": `${feedPaneWidth}px` } as React.CSSProperties}>
        <FeedPane {...feedPane} />
        <div aria-label="板一覧とコンテンツの境界" aria-orientation="vertical" className="feed-pane-splitter" onMouseDown={onStartFeedPaneResize} role="separator" />
        <section className="content-pane" ref={contentPaneRef} style={{ "--thread-list-height": `${threadListHeight}%` } as React.CSSProperties}>
          <ThreadListPane {...threadList} />
          <div aria-label="スレタイ一覧とスレ本文の境界" className="pane-splitter" onMouseDown={onStartVerticalResize} role="separator" />
          <section className="thread-workspace">
            {threadViewMode === "browser" ? (
              <ArticleBrowserPane {...articleBrowser} />
            ) : (
              <section className={`thread-content ${showArticlePane ? "has-article-pane" : ""}`} ref={threadContentRef} style={{ "--article-pane-width": `${articlePaneWidth}px` } as React.CSSProperties}>
                <ThreadReaderPane {...threadReader} />
                {showArticlePane ? (
                  <>
                    <div aria-label="レス一覧と記事本文の境界" aria-orientation="vertical" className="article-pane-splitter" onMouseDown={onStartArticlePaneResize} role="separator" />
                    <ArticleBodyPane {...articleBody} />
                  </>
                ) : null}
              </section>
            )}
          </section>
        </section>
      </div>
      <footer className="shortcut-bar" aria-label="キーボードショートカット">
        <span><kbd>p</kbd>/<kbd>n</kbd> レス／元記事スクロール</span>
        <span><kbd>Ctrl</kbd>+<kbd>j</kbd>/<kbd>k</kbd> レススクロール</span>
        <span><kbd>j</kbd>/<kbd>k</kbd> スレ移動</span>
        <span><kbd>i</kbd>/<kbd>I</kbd> 先頭／末尾スレ</span>
        <span><kbd>o</kbd> レス／元記事</span>
        <span><kbd>f</kbd>/<kbd>;</kbd> 元記事を全面表示</span>
        <span><kbd>Space</kbd>/<kbd>Shift</kbd>+<kbd>Space</kbd> 元記事スクロール</span>
        <span><kbd>h</kbd>/<kbd>l</kbd> 板移動</span>
        <span><kbd>g</kbd>/<kbd>u</kbd> AIレス</span>
        <span><kbd>w</kbd> 書き込み</span>
        <span><kbd>r</kbd>/<kbd>y</kbd> 更新</span>
        <span><kbd>b</kbd> お気に入り</span>
        <span><kbd>U</kbd> 既読切替</span>
      </footer>
    </>
  );
}
