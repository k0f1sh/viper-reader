import { useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { ThreadDetail, ThreadPost } from "../../shared/types";

type PopupData = { title: string; posts: ThreadPost[]; style: CSSProperties };

function popupPosition(element: HTMLElement, maxHeight: number): CSSProperties {
  const rect = element.getBoundingClientRect();
  const maxWidth = 480;
  let left = rect.left;
  let top = rect.bottom + 4;
  if (left + maxWidth > window.innerWidth) left = window.innerWidth - maxWidth - 16;
  if (left < 0) left = 8;
  if (top + maxHeight > window.innerHeight) {
    top = rect.top - maxHeight - 4;
    if (top < 0) top = window.innerHeight - maxHeight - 16;
  }
  return { left: `${left}px`, top: `${top}px` };
}

export function usePostPopup(selectedThread: ThreadDetail | null) {
  const [popupData, setPopupData] = useState<PopupData | null>(null);
  const [extractedPostId, setExtractedPostId] = useState<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearPopupTimeout() {
    if (!timeoutRef.current) return;
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }

  useEffect(() => () => clearPopupTimeout(), []);

  function closePopupWithDelay() {
    clearPopupTimeout();
    timeoutRef.current = setTimeout(() => setPopupData(null), 200);
  }

  function scrollToPost(postNo: number) {
    function scroll() {
      const element = document.getElementById(`post-${postNo}`);
      if (!element) return;
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
      element.classList.add("highlighted-post");
      setTimeout(() => element.classList.remove("highlighted-post"), 2000);
    }
    const targetPost = selectedThread?.posts.find((post) => post.no === postNo);
    if (extractedPostId && targetPost?.id !== extractedPostId) {
      setExtractedPostId(null);
      setTimeout(scroll, 0);
    } else {
      scroll();
    }
  }

  function showReplies(postNo: number, event: ReactMouseEvent<HTMLElement>) {
    if (!selectedThread) return;
    clearPopupTimeout();
    const regex = new RegExp(`>>${postNo}(?!\\d)`);
    const posts = selectedThread.posts.filter((post) => regex.test(post.body));
    if (!posts.length) return;
    setPopupData({
      title: `>>${postNo} への返信レス (${posts.length}件)`,
      posts,
      style: popupPosition(event.currentTarget, 300)
    });
  }

  function showAnchor(postNo: number, event: ReactMouseEvent<HTMLElement>) {
    if (!selectedThread) return;
    clearPopupTimeout();
    const post = selectedThread.posts.find((item) => item.no === postNo);
    if (!post) return;
    setPopupData({
      title: `>>${postNo} の内容`,
      posts: [post],
      style: popupPosition(event.currentTarget, 150)
    });
  }

  function showPostId(postId: string, event: ReactMouseEvent<HTMLElement>) {
    if (!selectedThread) return;
    clearPopupTimeout();
    const posts = selectedThread.posts.filter((post) => post.id === postId);
    if (!posts.length) return;
    setPopupData({
      title: `ID:${postId} の発言 (${posts.length}/${selectedThread.posts.length})`,
      posts,
      style: popupPosition(event.currentTarget, 300)
    });
  }

  function toggleExtractedPostId(postId: string) {
    setPopupData(null);
    setExtractedPostId((current) => current === postId ? null : postId);
    setTimeout(() => {
      const posts = document.querySelector<HTMLElement>(".posts");
      if (posts) posts.scrollTop = 0;
    }, 0);
  }

  return {
    popupData,
    extractedPostId,
    clearExtractedPostId: () => setExtractedPostId(null),
    closePopup: () => setPopupData(null),
    clearPopupTimeout,
    closePopupWithDelay,
    scrollToPost,
    showReplies,
    showAnchor,
    showPostId,
    toggleExtractedPostId
  };
}
