import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ArticleBodyContent, ThreadDetail, ThreadListItem } from "../../shared/types";

type UseThreadSelectionOptions = {
  isArticlePaneEnabled: boolean;
  setThreadList: Dispatch<SetStateAction<ThreadListItem[]>>;
  onSelectionStarted: (threadId: string | undefined) => void;
  onThreadRead: () => void;
  onReadMarkerChange: (postNo: number | null) => void;
};

export function useThreadSelection({
  isArticlePaneEnabled,
  setThreadList,
  onSelectionStarted,
  onThreadRead,
  onReadMarkerChange
}: UseThreadSelectionOptions) {
  const [selectedThreadId, setSelectedThreadId] = useState<string>();
  const [selectedThread, setSelectedThread] = useState<ThreadDetail | null>(null);
  const [articleBody, setArticleBody] = useState<ArticleBodyContent | null>(null);
  const [isArticleBodyLoading, setIsArticleBodyLoading] = useState(false);
  const selectedThreadIdRef = useRef<string | undefined>(undefined);
  const callbacksRef = useRef({ onSelectionStarted, onThreadRead, onReadMarkerChange });
  selectedThreadIdRef.current = selectedThreadId;
  callbacksRef.current = { onSelectionStarted, onThreadRead, onReadMarkerChange };

  const shouldShowArticlePane = isArticlePaneEnabled
    && Boolean(selectedThread && selectedThread.posts.length > 1);

  useEffect(() => {
    callbacksRef.current.onSelectionStarted(selectedThreadId);
    if (!selectedThreadId || !window.viperReader) {
      setSelectedThread(null);
      return;
    }

    void window.viperReader.getThread(selectedThreadId).then((thread) => {
      if (!thread) {
        if (selectedThreadIdRef.current === selectedThreadId) {
          setSelectedThreadId(undefined);
          setSelectedThread(null);
        }
        return;
      }
      setThreadList((currentThreads) => currentThreads.map((currentThread) =>
        currentThread.id === thread.id ? { ...currentThread, ...thread, isRead: true } : currentThread
      ));
      if (selectedThreadIdRef.current === selectedThreadId) {
        callbacksRef.current.onReadMarkerChange(thread.readMarkerNo);
        if (thread.readMarkerNo !== null) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            document.querySelector<HTMLElement>('[data-read-marker="true"]')?.scrollIntoView({ block: "start" });
          }));
        }
      }
      callbacksRef.current.onThreadRead();
      if (selectedThreadIdRef.current === selectedThreadId) setSelectedThread(thread);
    }).catch(() => {
      if (selectedThreadIdRef.current === selectedThreadId) setSelectedThread(null);
    });
  }, [selectedThreadId, setThreadList]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const postsContainer = document.querySelector<HTMLElement>(".posts");
      if (postsContainer) postsContainer.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedThreadId]);

  useEffect(() => {
    if (!selectedThreadId || !shouldShowArticlePane || !window.viperReader) {
      setArticleBody(null);
      setIsArticleBodyLoading(false);
      return;
    }
    const threadId = selectedThreadId;
    setArticleBody(null);
    setIsArticleBodyLoading(true);
    void window.viperReader.getArticleBody(threadId).then((body) => {
      if (selectedThreadIdRef.current === threadId) setArticleBody(body);
    }).finally(() => {
      if (selectedThreadIdRef.current === threadId) setIsArticleBodyLoading(false);
    });
  }, [selectedThreadId, selectedThread?.generationStatus, shouldShowArticlePane]);

  return {
    selectedThreadId,
    selectedThreadIdRef,
    setSelectedThreadId,
    selectedThread,
    setSelectedThread,
    articleBody,
    isArticleBodyLoading,
    shouldShowArticlePane
  };
}
