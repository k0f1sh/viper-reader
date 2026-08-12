import { useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { SmartView, ThreadDetail, ThreadGenerationAttempt, ThreadListItem } from "../../shared/types";

type UseThreadGenerationOptions = {
  selectedThreadIdRef: MutableRefObject<string | undefined>;
  smartViewRef: MutableRefObject<SmartView | null>;
  setThreadList: Dispatch<SetStateAction<ThreadListItem[]>>;
  setSelectedThread: Dispatch<SetStateAction<ThreadDetail | null>>;
  reloadGeneratedQueue: () => void;
  reloadQueueSummary: () => Promise<void>;
};

export function useThreadGeneration({
  selectedThreadIdRef,
  smartViewRef,
  setThreadList,
  setSelectedThread,
  reloadGeneratedQueue,
  reloadQueueSummary
}: UseThreadGenerationOptions) {
  const [generatingThreadIds, setGeneratingThreadIds] = useState<Set<string>>(() => new Set());
  const [progressByThreadId, setProgressByThreadId] = useState<Map<string, string>>(() => new Map());
  const [completedThreadIds, setCompletedThreadIds] = useState<Set<string>>(() => new Set());
  const [failureThreadId, setFailureThreadId] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<ThreadGenerationAttempt[]>([]);
  const [isAttemptsLoading, setIsAttemptsLoading] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const callbacksRef = useRef({ reloadGeneratedQueue, reloadQueueSummary });
  callbacksRef.current = { reloadGeneratedQueue, reloadQueueSummary };

  function setGenerationStarted(threadId: string) {
    setGeneratingThreadIds((current) => new Set(current).add(threadId));
    setProgressByThreadId((current) => new Map(current).set(threadId, "レス生成を準備中..."));
  }

  function clearGeneration(threadId: string) {
    setGeneratingThreadIds((current) => {
      const next = new Set(current);
      next.delete(threadId);
      return next;
    });
    setProgressByThreadId((current) => {
      const next = new Map(current);
      next.delete(threadId);
      return next;
    });
  }

  useEffect(() => {
    if (!window.viperReader) return;
    return window.viperReader.onThreadGenerationProgress((progress) => {
      setProgressByThreadId((current) => new Map(current).set(progress.threadId, progress.message));
    });
  }, []);

  useEffect(() => {
    if (!window.viperReader) return;
    return window.viperReader.onThreadGenerationComplete((status) => {
      clearGeneration(status.threadId);
      const generationStatus = status.status === "error" ? "failed" : "completed";
      setThreadList((current) => current.map((thread) =>
        thread.id === status.threadId ? { ...thread, generationStatus } : thread
      ));
      setSelectedThread((thread) => thread?.id === status.threadId ? { ...thread, generationStatus } : thread);

      if (status.status === "done") {
        if (status.threadId !== selectedThreadIdRef.current) {
          setCompletedThreadIds((current) => new Set(current).add(status.threadId));
        }
        void window.viperReader?.getThread(status.threadId).then((thread) => {
          if (!thread) return;
          const isSelected = status.threadId === selectedThreadIdRef.current;
          setThreadList((current) => current.map((item) =>
            item.id === thread.id ? { ...item, ...thread, isRead: isSelected ? true : item.isRead } : item
          ));
          if (isSelected) setSelectedThread(thread);
        });
        if (smartViewRef.current === "generated") callbacksRef.current.reloadGeneratedQueue();
      }
      void callbacksRef.current.reloadQueueSummary();
    });
  }, [selectedThreadIdRef, setSelectedThread, setThreadList, smartViewRef]);

  async function generate(thread: ThreadDetail, force = false) {
    if (!window.viperReader || generatingThreadIds.has(thread.id)) return;
    setGenerationStarted(thread.id);
    try {
      await window.viperReader.generateThreadResponses(thread.id, force);
      await callbacksRef.current.reloadQueueSummary();
    } catch {
      clearGeneration(thread.id);
    }
  }

  async function showFailure(threadId: string) {
    if (!window.viperReader) return;
    setFailureThreadId(threadId);
    setAttempts([]);
    setIsAttemptsLoading(true);
    try {
      setAttempts(await window.viperReader.listThreadGenerationAttempts(threadId));
    } finally {
      setIsAttemptsLoading(false);
    }
  }

  async function retryFailure() {
    if (!window.viperReader || !failureThreadId || isRetrying) return;
    const threadId = failureThreadId;
    setIsRetrying(true);
    setGenerationStarted(threadId);
    setThreadList((current) => current.map((thread) =>
      thread.id === threadId ? { ...thread, generationStatus: "queued" } : thread
    ));
    try {
      await window.viperReader.generateThreadResponses(threadId, true);
      setFailureThreadId(null);
      await callbacksRef.current.reloadQueueSummary();
    } finally {
      setIsRetrying(false);
    }
  }

  function clearCompleted(threadId: string) {
    setCompletedThreadIds((current) => {
      if (!current.has(threadId)) return current;
      const next = new Set(current);
      next.delete(threadId);
      return next;
    });
  }

  return {
    generatingThreadIds,
    progressByThreadId,
    completedThreadIds,
    failureThreadId,
    attempts,
    isAttemptsLoading,
    isRetrying,
    generate,
    showFailure,
    retryFailure,
    closeFailure: () => setFailureThreadId(null),
    clearCompleted
  };
}
