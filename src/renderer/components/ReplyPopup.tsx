import type { CSSProperties } from "react";
import type { ThreadPost } from "../../shared/types";
import { PostBody } from "./PostBody";

type ReplyPopupProps = {
  popupData: {
    title: string;
    posts: ThreadPost[];
    style: CSSProperties;
  };
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onAnchorClick: (postNo: number) => void;
};

export function ReplyPopup({ popupData, onMouseEnter, onMouseLeave, onAnchorClick }: ReplyPopupProps) {
  return (
    <div
      className="reply-popup"
      style={popupData.style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
            <PostBody body={post.body} onAnchorClick={onAnchorClick} />
          </div>
        </article>
      ))}
    </div>
  );
}
