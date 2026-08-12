import { useEffect, useRef } from "react";
import type { Dispatch, FormEvent, MutableRefObject, RefObject, SetStateAction } from "react";
import type { ThreadDetail, ThreadListItem } from "../../shared/types";
import { useReplyComposer } from "./useAppForms";

type UsePostingOptions = {
  selectedThreadId: string | undefined;
  selectedThreadIdRef: MutableRefObject<string | undefined>;
  selectedThread: ThreadDetail | null;
  setSelectedThread: Dispatch<SetStateAction<ThreadDetail | null>>;
  setThreadList: Dispatch<SetStateAction<ThreadListItem[]>>;
  setReadMarkerNo: Dispatch<SetStateAction<number | null>>;
  replyBodyRef: RefObject<HTMLTextAreaElement | null>;
  reloadFeeds: () => Promise<void>;
  reloadCurrentThreadList: (preferredThreadId?: string) => Promise<void>;
};

function scrollReadMarkerToTop() {
  setTimeout(() => {
    const posts = document.querySelector<HTMLElement>(".posts");
    const marker = document.querySelector<HTMLElement>('[data-read-marker="true"]');
    if (!posts || !marker) return;
    posts.scrollTop += marker.getBoundingClientRect().top - posts.getBoundingClientRect().top;
  }, 100);
}

export function usePosting(options: UsePostingOptions) {
  const { composer, update, setBody } = useReplyComposer();
  const draftsRef = useRef<Map<string, string>>(new Map());
  const postingThreadIdRef = useRef<string | null>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!window.viperReader) return;
    return window.viperReader.onPostStatus((data) => {
      const current = optionsRef.current;
      if ((data.status === "done" || data.status === "error") && data.threadId === postingThreadIdRef.current) {
        postingThreadIdRef.current = null;
        update({ isPosting: false });
      }
      if (data.status === "done" && data.threadId !== current.selectedThreadId) {
        void Promise.all([
          current.reloadFeeds(),
          current.reloadCurrentThreadList()
        ]);
        return;
      }
      if (data.threadId !== current.selectedThreadId) return;
      update({ status: data.status });
      if (data.status !== "done" && data.status !== "error") return;
      if (data.status === "error") {
        update({ error: `${data.errorMessage ?? "AI住民のレス生成に失敗しました。"} 書き込みは保存されています。` });
      }
      void window.viperReader?.getThread(data.threadId).then((thread) => {
        if (!thread) return;
        if (data.status === "error") {
          current.setSelectedThread(thread);
          current.setThreadList((items) => items.map((item) =>
            item.id === thread.id ? { ...item, ...thread, isRead: true } : item
          ));
          void current.reloadFeeds();
          return;
        }
        return window.viperReader?.setThreadRead(data.threadId, false).then(() => {
          current.setSelectedThread(thread);
          current.setThreadList((items) => items.map((item) =>
            item.id === thread.id ? { ...item, ...thread, isRead: false } : item
          ));
          void Promise.all([
            current.reloadFeeds(),
            current.reloadCurrentThreadList(thread.id)
          ]);
        });
      });
    });
  }, []);

  function switchThread(previousThreadId: string | undefined, nextThreadId: string) {
    if (previousThreadId === nextThreadId) return;
    if (previousThreadId) draftsRef.current.set(previousThreadId, composer.body);
    setBody(draftsRef.current.get(nextThreadId) ?? "");
    update({ error: "", status: "idle" });
  }

  function replyToPost(postNo: number) {
    const anchor = `>>${postNo}\n`;
    setBody((current) => current.startsWith(anchor) ? current : `${anchor}${current}`);
    setTimeout(() => optionsRef.current.replyBodyRef.current?.focus(), 0);
  }

  function applyResult(
    threadId: string,
    markerNo: number,
    result: ThreadDetail,
    clearBody: boolean,
    isRead = true
  ) {
    const current = optionsRef.current;
    if (current.selectedThreadIdRef.current === threadId) {
      current.setReadMarkerNo(markerNo);
      current.setSelectedThread(result);
      if (clearBody) setBody("");
    }
    current.setThreadList((items) => items.map((item) =>
      item.id === result.id ? { ...item, ...result, isRead } : item
    ));
    void current.reloadFeeds();
    if (current.selectedThreadIdRef.current === threadId) scrollReadMarkerToTop();
  }

  async function postMessage(event: FormEvent) {
    event.preventDefault();
    const current = optionsRef.current;
    const thread = current.selectedThread;
    if (!thread || !window.viperReader || composer.isPosting || !composer.body.trim()) return;
    const markerNo = thread.posts.reduce((max, post) => Math.max(max, post.no), 0);
    update({ isPosting: true, error: "", status: "idle" });
    postingThreadIdRef.current = thread.id;
    try {
      const result = await window.viperReader.postMessage(thread.id, composer.name, composer.mail, composer.body);
      if (result) {
        draftsRef.current.delete(result.id);
        applyResult(thread.id, markerNo, result, true);
      }
    } catch (error) {
      if (current.selectedThreadIdRef.current === thread.id) {
        update({ error: error instanceof Error ? error.message : "書き込みに失敗しました。", status: "idle" });
      }
      if (postingThreadIdRef.current === thread.id) {
        postingThreadIdRef.current = null;
        update({ isPosting: false });
      }
    }
  }

  async function generateReplies() {
    const current = optionsRef.current;
    const thread = current.selectedThread;
    if (!thread || !window.viperReader || composer.isPosting) return;
    const markerNo = thread.posts.reduce((max, post) => Math.max(max, post.no), 0);
    update({ isPosting: true, error: "" });
    postingThreadIdRef.current = thread.id;
    const unsubscribe = window.viperReader.onPostStatus((data) => {
      if (data.threadId === thread.id && current.selectedThreadIdRef.current === thread.id) update({ status: data.status });
    });
    try {
      const result = await window.viperReader.generateReplies(thread.id);
      if (result) {
        await window.viperReader.setThreadRead(thread.id, false);
        applyResult(thread.id, markerNo, result, false, false);
      }
    } catch (error) {
      if (current.selectedThreadIdRef.current === thread.id) {
        update({ error: error instanceof Error ? error.message : "レス生成に失敗しました。" });
      }
    } finally {
      unsubscribe();
      if (postingThreadIdRef.current === thread.id) {
        postingThreadIdRef.current = null;
        update({ isPosting: false });
      }
      update({ status: "idle" });
    }
  }

  return {
    composer: {
      ...composer,
      isPosting: composer.isPosting && postingThreadIdRef.current === options.selectedThreadId
    },
    update,
    setBody,
    switchThread,
    replyToPost,
    postMessage,
    generateReplies
  };
}
