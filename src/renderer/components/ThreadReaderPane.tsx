import { isLocalBoard, canUseThreadPane } from "../../shared/boardPolicy";
import { Fragment } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { ThreadDetail } from "../../shared/types";
import { PostBody } from "./PostBody";
import { formatArticleTags } from "../../shared/articleTags";

type ThreadReaderPaneProps = {
  canRunCommandHook: boolean;
  commandHookRunning: boolean;
  onRunCommandHook: () => void;
  selectedThread: ThreadDetail | null;
  isSelectedThreadGenerating: boolean;
  generationProgressMessage: string;
  isRegeneratingTitle: boolean;
  skipTitleConversion: boolean;
  isPosting: boolean;
  postStatus: "idle" | "writing" | "generating" | "done" | "error";
  postError: string;
  replyName: string;
  replyMail: string;
  replyBody: string;
  readMarkerNo: number | null;
  extractedPostId: string | null;
  replyBodyRef: RefObject<HTMLTextAreaElement | null>;
  onToggleFavorite: () => void;
  onRegenerateThreadTitle: () => void;
  onGenerateResponses: (force?: boolean) => void;
  onGenerateReplies: () => void;
  onDeleteContent: () => void;
  isDeletingContent: boolean;
  onPostMessage: (event: FormEvent) => void;
  onReplyNameChange: (value: string) => void;
  onReplyMailChange: (value: string) => void;
  onReplyBodyChange: (value: string) => void;
  onReplyToPost: (postNo: number) => void;
  onScrollToPost: (postNo: number) => void;
  onPostNoMouseEnter: (postNo: number, event: ReactMouseEvent<HTMLElement>) => void;
  onPostNoMouseLeave: () => void;
  onPostIdClick: (postId: string) => void;
  onPostIdMouseEnter: (postId: string, event: ReactMouseEvent<HTMLElement>) => void;
  onPostIdMouseLeave: () => void;
  onAnchorMouseEnter: (postNo: number, event: ReactMouseEvent<HTMLElement>) => void;
  onAnchorMouseLeave: () => void;
  isArticlePaneVisible: boolean;
  onToggleArticlePane: () => void;
  onShowArticleBrowser: () => void;
  isWritePanelVisible: boolean;
  onToggleWritePanel: () => void;
};

export function ThreadReaderPane({
  canRunCommandHook,
  commandHookRunning,
  onRunCommandHook,
  selectedThread,
  isSelectedThreadGenerating,
  generationProgressMessage,
  isRegeneratingTitle,
  skipTitleConversion,
  isPosting,
  postStatus,
  postError,
  replyName,
  replyMail,
  replyBody,
  readMarkerNo,
  extractedPostId,
  replyBodyRef,
  onToggleFavorite,
  onRegenerateThreadTitle,
  onGenerateResponses,
  onGenerateReplies,
  onDeleteContent,
  isDeletingContent,
  onPostMessage,
  onReplyNameChange,
  onReplyMailChange,
  onReplyBodyChange,
  onReplyToPost,
  onScrollToPost,
  onPostNoMouseEnter,
  onPostNoMouseLeave,
  onPostIdClick,
  onPostIdMouseEnter,
  onPostIdMouseLeave,
  onAnchorMouseEnter,
  onAnchorMouseLeave,
  isArticlePaneVisible,
  onToggleArticlePane,
  onShowArticleBrowser,
  isWritePanelVisible,
  onToggleWritePanel
}: ThreadReaderPaneProps) {
  const isLocal = isLocalBoard(selectedThread);
  const canUsePane = canUseThreadPane(selectedThread);
  const hasArticleUpdate = Boolean(selectedThread && selectedThread.contentVersion !== selectedThread.generatedContentVersion);
  const isWritePanelBusy = isPosting || isSelectedThreadGenerating;
  const writePanelStatus =
    postStatus === "generating"
      ? "AI住民がレスを生成しています"
      : postStatus === "writing"
        ? "書き込みを保存しています"
        : isSelectedThreadGenerating
          ? "レスを生成しています"
          : "書き込みを処理しています";
  const idPostCounts = new Map<string, number>();
  for (const post of selectedThread?.posts ?? []) {
    idPostCounts.set(post.id, (idPostCounts.get(post.id) ?? 0) + 1);
  }
  const visiblePosts = extractedPostId
    ? selectedThread?.posts.filter((post) => post.id === extractedPostId) ?? []
    : selectedThread?.posts ?? [];

  return (
    <section className="thread-body-pane" aria-label="スレ本文">
      {selectedThread ? (
        <section className="thread-reader-pane" aria-label="スレ本文">
          <div className="thread-header">
            <div>
              <div className="thread-heading">{selectedThread.threadTitle}</div>
              {!isLocal ? <div className="original-title">元記事: {selectedThread.originalTitle}</div> : null}
              {!isLocal ? <div className="article-tags">タグ: {formatArticleTags(selectedThread.tags)}</div> : null}
            </div>
            <div className="thread-header-actions">
              <button className="deep-dive-button" type="button" disabled={!canRunCommandHook} onClick={onRunCommandHook} title="外部コマンドフックを実行 (t)">
                {commandHookRunning ? "フック実行中..." : "フック実行"}
              </button>
              {selectedThread.url ? <button className="deep-dive-button" onClick={onShowArticleBrowser} type="button">
                元記事
              </button> : null}
              {canUsePane ? (
                <button
                  className={`deep-dive-button ${isArticlePaneVisible ? "is-active" : ""}`}
                  onClick={onToggleArticlePane}
                  type="button"
                >
                  {isArticlePaneVisible ? "記事本文を閉じる" : "記事本文"}
                </button>
              ) : null}
              {canUsePane ? (
                <button
                  className={`deep-dive-button ${isWritePanelVisible ? "is-active" : ""}`}
                  onClick={onToggleWritePanel}
                  type="button"
                  aria-expanded={isWritePanelVisible}
                  aria-controls="write-panel"
                >
                  {isWritePanelVisible ? "書き込み欄を隠す" : "書き込み欄を表示"}
                </button>
              ) : null}
              <button
                className={`deep-dive-button favorite-button ${selectedThread.isFavorite ? "is-favorite-active" : ""}`}
                onClick={onToggleFavorite}
                type="button"
                title={selectedThread.isFavorite ? "お気に入り解除" : "お気に入りに追加"}
              >
                {selectedThread.isFavorite ? "★ お気に入り解除" : "☆ お気に入り"}
              </button>
              {!isLocal && !skipTitleConversion ? (
                <button
                  className="deep-dive-button"
                  onClick={onRegenerateThreadTitle}
                  disabled={isRegeneratingTitle}
                  type="button"
                  title="このスレだけスレタイを再生成"
                >
                  {isRegeneratingTitle ? "スレタイ生成中..." : "スレタイ再生成"}
                </button>
              ) : null}
              <button
                className="deep-dive-button"
                onClick={onDeleteContent}
                disabled={isDeletingContent || isWritePanelBusy}
                type="button"
                title={isLocal ? "このスレを本文・全レスごと物理削除" : "記事本文のキャッシュと、このスレの書き込みを物理削除"}
              >
                {isDeletingContent ? "削除中..." : isLocal ? "スレ削除" : "本文・レス削除"}
              </button>
              {!isLocal && selectedThread.posts.length <= 1 ? (
                <button
                  className="deep-dive-button"
                  onClick={() => onGenerateResponses()}
                  disabled={isSelectedThreadGenerating}
                  type="button"
                  title="生成を開始して、完了を待たずに別の記事へ移動できます"
                >
                  {isSelectedThreadGenerating ? "生成中..." : "生成"}
                </button>
              ) : null}
              {!isLocal && selectedThread.posts.length > 1 && !selectedThread.posts.some((post) => post.isUser) ? (
                <button
                  className="deep-dive-button"
                  onClick={() => onGenerateResponses(true)}
                  disabled={isSelectedThreadGenerating}
                  type="button"
                >
                  再生成
                </button>
              ) : null}
            </div>
          </div>
          {hasArticleUpdate ? (
            <div className="id-extraction-bar" role="status">
              <span>記事に更新あり。既存のAIレスは更新前の内容です。更新すると本文を取得し直し、AIレスを置き換えます。書き込みとその番号は保持します。</span>
              <button type="button" disabled={isWritePanelBusy} onClick={() => onGenerateResponses(true)}>
                本文・AIレスを更新
              </button>
            </div>
          ) : null}
          <div className="posts">
            {extractedPostId ? (
              <div className="id-extraction-bar" role="status">
                <span>
                  ID:{extractedPostId} の発言を抽出中（{visiblePosts.length}/{selectedThread.posts.length}）
                </span>
                <button onClick={() => onPostIdClick(extractedPostId)} type="button">抽出解除</button>
              </div>
            ) : null}
            {visiblePosts.map((post) => {
              const replyRegex = new RegExp(`>>${post.no}(?!\\d)`);
              const hasReplies = selectedThread.posts.some((candidate) => replyRegex.test(candidate.body));
              return (
                <Fragment key={`${selectedThread.id}-${post.no}`}>
                  <FragmentPost
                    selectedThreadId={selectedThread.id}
                    post={post}
                    hasReplies={hasReplies}
                    idPostCount={idPostCounts.get(post.id) ?? 1}
                    totalPostCount={selectedThread.posts.length}
                    isIdExtracted={extractedPostId === post.id}
                    readMarkerNo={readMarkerNo}
                    onScrollToPost={onScrollToPost}
                    onPostNoMouseEnter={onPostNoMouseEnter}
                    onPostNoMouseLeave={onPostNoMouseLeave}
                    onPostIdClick={onPostIdClick}
                    onPostIdMouseEnter={onPostIdMouseEnter}
                    onPostIdMouseLeave={onPostIdMouseLeave}
                    onAnchorMouseEnter={onAnchorMouseEnter}
                    onAnchorMouseLeave={onAnchorMouseLeave}
                    onReplyToPost={onReplyToPost}
                  />
                </Fragment>
              );
            })}
            {!isLocal && selectedThread.posts.length <= 1 && !isSelectedThreadGenerating ? (
              <div className="thread-load-trigger">
                <button
                  className="load-button"
                  onClick={() => onGenerateResponses()}
                  type="button"
                >
                  読み込む（生成）
                </button>
              </div>
            ) : null}
            {canUsePane && !isSelectedThreadGenerating && getMaxPostNo(selectedThread) < 1000 ? (
              <div className="thread-load-trigger" style={{ marginTop: "12px", marginBottom: "12px", textAlign: "center" }}>
                <button
                  className="load-button"
                  onClick={onGenerateReplies}
                  disabled={isPosting || hasArticleUpdate}
                  type="button"
                >
                  {postStatus === "generating" ? "レス生成中..." : isLocal ? "返信生成" : "再読み込み(続きのレス生成)"}
                </button>
              </div>
            ) : null}
            {isSelectedThreadGenerating ? (
              <div className="thread-response-loading" role="status" aria-live="polite">
                <span>{generationProgressMessage || "レス生成を準備中..."}</span>
                <span className="progress-blocks" aria-hidden="true" />
              </div>
            ) : null}
          </div>
          {canUsePane && isWritePanelVisible ? (
            <form
              id="write-panel"
              className={`write-panel ${isWritePanelBusy ? "is-busy" : ""}`}
              onSubmit={onPostMessage}
              aria-busy={isWritePanelBusy}
            >
              {isWritePanelBusy ? (
                <div className="write-panel-busy" role="status" aria-live="polite">
                  <span>{writePanelStatus}。完了するまでお待ちください。</span>
                  <span className="progress-blocks" aria-hidden="true" />
                </div>
              ) : null}
              <div className="write-meta-row">
                <label htmlFor="reply-name">名前:</label>
                <input
                  id="reply-name"
                  type="text"
                  value={replyName}
                  onChange={(event) => onReplyNameChange(event.target.value)}
                  placeholder="省略可"
                  disabled={isPosting || isSelectedThreadGenerating || selectedThread.posts.length >= 1000}
                />
                <label htmlFor="reply-mail">E-mail:</label>
                <input
                  id="reply-mail"
                  type="text"
                  value={replyMail}
                  onChange={(event) => onReplyMailChange(event.target.value)}
                  placeholder="sage"
                  disabled={isPosting || isSelectedThreadGenerating || selectedThread.posts.length >= 1000}
                />
                {selectedThread.posts.length >= 1000 ? (
                  <span className="thread-closed-msg">このスレッドは1000レスに達したため書き込めません。</span>
                ) : (
                  <button
                    type="submit"
                    className="post-submit-btn"
                    disabled={isPosting || isSelectedThreadGenerating || !replyBody.trim()}
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
                  ref={replyBodyRef}
                  value={replyBody}
                  onChange={(event) => onReplyBodyChange(event.target.value)}
                  placeholder={
                    selectedThread.posts.length >= 1000
                      ? "書き込み限界です"
                      : isWritePanelBusy
                      ? "レス生成中は書き込めません"
                      : "本文（Ctrl+Enterで書き込み）"
                  }
                  readOnly={isPosting || isSelectedThreadGenerating || selectedThread.posts.length >= 1000}
                  aria-disabled={isPosting || isSelectedThreadGenerating || selectedThread.posts.length >= 1000}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
                      onPostMessage(event as unknown as FormEvent);
                    }
                  }}
                />
              </div>
              {postError && <div className="write-error-msg">{postError}</div>}
            </form>
          ) : null}
        </section>
      ) : (
        <div className="empty-state">スレッドがありません。板を選んで更新するか、自由板でスレを立ててください。</div>
      )}
    </section>
  );
}

function FragmentPost({
  selectedThreadId,
  post,
  hasReplies,
  idPostCount,
  totalPostCount,
  isIdExtracted,
  readMarkerNo,
  onScrollToPost,
  onPostNoMouseEnter,
  onPostNoMouseLeave,
  onPostIdClick,
  onPostIdMouseEnter,
  onPostIdMouseLeave,
  onAnchorMouseEnter,
  onAnchorMouseLeave,
  onReplyToPost
}: {
  selectedThreadId: string;
  post: ThreadDetail["posts"][number];
  hasReplies: boolean;
  idPostCount: number;
  totalPostCount: number;
  isIdExtracted: boolean;
  readMarkerNo: number | null;
  onScrollToPost: (postNo: number) => void;
  onPostNoMouseEnter: (postNo: number, event: ReactMouseEvent<HTMLElement>) => void;
  onPostNoMouseLeave: () => void;
  onPostIdClick: (postId: string) => void;
  onPostIdMouseEnter: (postId: string, event: ReactMouseEvent<HTMLElement>) => void;
  onPostIdMouseLeave: () => void;
  onAnchorMouseEnter: (postNo: number, event: ReactMouseEvent<HTMLElement>) => void;
  onAnchorMouseLeave: () => void;
  onReplyToPost: (postNo: number) => void;
}) {
  return (
    <>
      <article className={`post ${post.isUser ? "is-user-post" : ""}`} id={`post-${post.no}`}>
        <div className="post-meta">
          <span
            className={`post-no ${hasReplies ? "post-no-hoverable" : ""}`}
            onMouseEnter={hasReplies ? (event) => onPostNoMouseEnter(post.no, event) : undefined}
            onMouseLeave={hasReplies ? onPostNoMouseLeave : undefined}
            onClick={() => onReplyToPost(post.no)}
            title={`>>${post.no} を書き込み欄へ追加`}
          >
            {post.no} ：
          </span>
          <span className="post-name">{post.name}</span>
          {post.mail ? <span className="post-mail">[{post.mail}]</span> : null}
          <span className="post-date">{post.date}</span>
          <button
            aria-pressed={isIdExtracted}
            className={`post-id ${isIdExtracted ? "is-extracted" : ""}`}
            onClick={() => onPostIdClick(post.id)}
            onMouseEnter={(event) => onPostIdMouseEnter(post.id, event)}
            onMouseLeave={onPostIdMouseLeave}
            title={`ID:${post.id} の発言を抽出`}
            type="button"
          >
            ID:{post.id} ({idPostCount}/{totalPostCount})
          </button>
        </div>
        <div className="post-body">
          <PostBody
            body={post.body}
            rssContent={post.rssContent}
            onAnchorClick={onScrollToPost}
            onAnchorMouseEnter={onAnchorMouseEnter}
            onAnchorMouseLeave={onAnchorMouseLeave}
            showUrlCopyButton={post.no === 1}
          />
        </div>
      </article>
      {readMarkerNo === post.no ? (
        <div
          className="read-marker"
          data-read-marker="true"
          key={`marker-${selectedThreadId}-${post.no}`}
        >
          <span>───────── ここまで読んだ ─────────</span>
        </div>
      ) : null}
    </>
  );
}

function getMaxPostNo(thread: ThreadDetail): number {
  return thread.posts.reduce((max, post) => Math.max(max, post.no), 0);
}
