import type { FormEvent, MouseEvent as ReactMouseEvent, RefObject } from "react";
import type { ThreadDetail } from "../../shared/types";
import { PostBody } from "./PostBody";

type ThreadReaderPaneProps = {
  selectedThread: ThreadDetail | null;
  isSelectedThreadGenerating: boolean;
  isPosting: boolean;
  postStatus: "idle" | "writing" | "generating" | "done" | "error";
  postError: string;
  replyName: string;
  replyMail: string;
  replyBody: string;
  readMarkerNo: number | null;
  replyBodyRef: RefObject<HTMLTextAreaElement | null>;
  onToggleFavorite: () => void;
  onGenerateResponses: (force?: boolean) => void;
  onGenerateReplies: () => void;
  onPostMessage: (event: FormEvent) => void;
  onReplyNameChange: (value: string) => void;
  onReplyMailChange: (value: string) => void;
  onReplyBodyChange: (value: string) => void;
  onScrollToPost: (postNo: number) => void;
  onPostNoMouseEnter: (postNo: number, event: ReactMouseEvent<HTMLElement>) => void;
  onPostNoMouseLeave: () => void;
  onAnchorMouseEnter: (postNo: number, event: ReactMouseEvent<HTMLElement>) => void;
  onAnchorMouseLeave: () => void;
};

export function ThreadReaderPane({
  selectedThread,
  isSelectedThreadGenerating,
  isPosting,
  postStatus,
  postError,
  replyName,
  replyMail,
  replyBody,
  readMarkerNo,
  replyBodyRef,
  onToggleFavorite,
  onGenerateResponses,
  onGenerateReplies,
  onPostMessage,
  onReplyNameChange,
  onReplyMailChange,
  onReplyBodyChange,
  onScrollToPost,
  onPostNoMouseEnter,
  onPostNoMouseLeave,
  onAnchorMouseEnter,
  onAnchorMouseLeave
}: ThreadReaderPaneProps) {
  return (
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
                onClick={onToggleFavorite}
                type="button"
                title={selectedThread.isFavorite ? "お気に入り解除" : "お気に入りに追加"}
              >
                {selectedThread.isFavorite ? "★ お気に入り解除" : "☆ お気に入り"}
              </button>
              {selectedThread.posts.length > 1 && !selectedThread.posts.some((post) => post.isUser) ? (
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
          <div className="posts">
            {selectedThread.posts.map((post) => {
              const replyRegex = new RegExp(`>>${post.no}(?!\\d)`);
              const hasReplies = selectedThread.posts.some((candidate) => replyRegex.test(candidate.body));
              return (
                <FragmentPost
                  key={`${selectedThread.id}-${post.no}`}
                  selectedThreadId={selectedThread.id}
                  post={post}
                  hasReplies={hasReplies}
                  readMarkerNo={readMarkerNo}
                  onScrollToPost={onScrollToPost}
                  onPostNoMouseEnter={onPostNoMouseEnter}
                  onPostNoMouseLeave={onPostNoMouseLeave}
                  onAnchorMouseEnter={onAnchorMouseEnter}
                  onAnchorMouseLeave={onAnchorMouseLeave}
                />
              );
            })}
            {selectedThread.posts.length <= 1 && !isSelectedThreadGenerating ? (
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
            {selectedThread.posts.length > 1 && !isSelectedThreadGenerating && getMaxPostNo(selectedThread) < 1000 ? (
              <div className="thread-load-trigger" style={{ marginTop: "12px", marginBottom: "12px", textAlign: "center" }}>
                <button
                  className="load-button"
                  onClick={onGenerateReplies}
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
            <form className="write-panel" onSubmit={onPostMessage}>
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
                      : isSelectedThreadGenerating
                      ? "レス生成中は書き込めません"
                      : "本文（Ctrl+Enterで書き込み）"
                  }
                  disabled={isPosting || isSelectedThreadGenerating || selectedThread.posts.length >= 1000}
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
        <div className="empty-state">記事がありません。RSSを選んで更新してください。</div>
      )}
    </section>
  );
}

function FragmentPost({
  selectedThreadId,
  post,
  hasReplies,
  readMarkerNo,
  onScrollToPost,
  onPostNoMouseEnter,
  onPostNoMouseLeave,
  onAnchorMouseEnter,
  onAnchorMouseLeave
}: {
  selectedThreadId: string;
  post: ThreadDetail["posts"][number];
  hasReplies: boolean;
  readMarkerNo: number | null;
  onScrollToPost: (postNo: number) => void;
  onPostNoMouseEnter: (postNo: number, event: ReactMouseEvent<HTMLElement>) => void;
  onPostNoMouseLeave: () => void;
  onAnchorMouseEnter: (postNo: number, event: ReactMouseEvent<HTMLElement>) => void;
  onAnchorMouseLeave: () => void;
}) {
  return (
    <>
      <article className={`post ${post.isUser ? "is-user-post" : ""}`} id={`post-${post.no}`}>
        <div className="post-meta">
          <span
            className={`post-no ${hasReplies ? "post-no-hoverable" : ""}`}
            onMouseEnter={hasReplies ? (event) => onPostNoMouseEnter(post.no, event) : undefined}
            onMouseLeave={hasReplies ? onPostNoMouseLeave : undefined}
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
            onAnchorClick={onScrollToPost}
            onAnchorMouseEnter={onAnchorMouseEnter}
            onAnchorMouseLeave={onAnchorMouseLeave}
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
