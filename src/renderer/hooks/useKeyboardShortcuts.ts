import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import type { FeedSource, SmartView, ThreadDetail, ThreadListItem } from "../../shared/types";
import { allFeedsId } from "./useFeedTree";

type ThreadViewMode = "replies" | "browser";

type UseKeyboardShortcutsOptions = {
  feeds: FeedSource[];
  threads: ThreadListItem[];
  selectedThreadId: string | undefined;
  selectedThread: ThreadDetail | null;
  selectedFeedId: string;
  smartView: SmartView | null;
  threadViewMode: ThreadViewMode;
  isArticleBrowserExpanded: boolean;
  extractedPostId: string | null;
  replyBodyRef: RefObject<HTMLTextAreaElement | null>;
  onSelectThread: (thread: ThreadListItem, feedSelection?: string) => void;
  onSelectFeed: (feedId: string) => void;
  onSelectSmartView: (view: SmartView) => void;
  onMoveToNextPage: () => void;
  onMoveToPreviousPage: () => void;
  onRefresh: () => void;
  onGenerateResponses: () => void;
  onGenerateReplies: () => void;
  onToggleFavorite: () => void;
  onToggleThreadRead: () => void;
  onToggleThreadView: () => void;
  onToggleArticleBrowserExpanded: () => void;
  onClearExtractedPost: () => void;
};

function scrollPosts(direction: -1 | 1) {
  const posts = document.querySelector<HTMLElement>(".posts");
  if (!posts) return;
  const distance = Math.max(80, Math.round(posts.clientHeight * 0.35));
  posts.scrollBy({ top: direction * distance, behavior: "smooth" });
}

function isEditableTarget(target: HTMLElement | null): boolean {
  if (!target) return false;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
    return !target.readOnly && !target.disabled;
  }
  if (target instanceof HTMLSelectElement) return !target.disabled;
  return target.isContentEditable;
}

export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const current = optionsRef.current;
      const target = event.target as HTMLElement | null;
      const primaryModifier = event.ctrlKey || event.metaKey;

      if (event.key === "Escape" && target === current.replyBodyRef.current) {
        event.preventDefault();
        target?.blur();
        return;
      }
      if (event.key === "Escape" && current.extractedPostId) {
        event.preventDefault();
        current.onClearExtractedPost();
        return;
      }
      if (event.key === "Escape" && current.isArticleBrowserExpanded) {
        event.preventDefault();
        current.onToggleArticleBrowserExpanded();
        return;
      }
      if (document.querySelector("[role='dialog']")) return;
      if (isEditableTarget(target)) return;

      if (event.ctrlKey && !event.metaKey && !event.altKey && (event.key === "j" || event.key === "k")) {
        scrollPosts(event.key === "j" ? 1 : -1);
        event.preventDefault();
        return;
      }
      if (primaryModifier || event.altKey) return;

      const index = current.threads.findIndex((thread) => thread.id === current.selectedThreadId);
      if (event.key === " " && current.threadViewMode !== "replies") {
        event.preventDefault();
        void window.viperReader?.scrollArticleBrowser(event.shiftKey ? -1 : 1);
      } else if (event.key === "p" || event.key === "n") {
        event.preventDefault();
        if (current.threadViewMode === "browser") {
          void window.viperReader?.scrollArticleBrowser(event.key === "n" ? 1 : -1);
        } else {
          scrollPosts(event.key === "n" ? 1 : -1);
        }
      } else if (event.key === "j" || event.key === "k") {
        const delta = event.key === "j" ? 1 : -1;
        const nextIndex = index < 0 ? (delta > 0 ? 0 : current.threads.length - 1) : index + delta;
        const next = current.threads[nextIndex];
        if (next) {
          event.preventDefault();
          current.onSelectThread(next, current.selectedFeedId === allFeedsId ? allFeedsId : undefined);
        } else if (index >= 0) {
          event.preventDefault();
          if (delta > 0) current.onMoveToNextPage();
          else current.onMoveToPreviousPage();
        }
      } else if (event.key === "i") {
        const first = current.threads[0];
        if (first) {
          event.preventDefault();
          current.onSelectThread(first, current.selectedFeedId === allFeedsId ? allFeedsId : undefined);
        }
      } else if (event.key === "I") {
        const last = current.threads.at(-1);
        if (last) {
          event.preventDefault();
          current.onSelectThread(last, current.selectedFeedId === allFeedsId ? allFeedsId : undefined);
        }
      } else if (event.key === "h" || event.key === "l") {
        const navigationTargets = [
          { id: "__unread_queue__", select: () => current.onSelectSmartView("unread") },
          { id: "__generated_queue__", select: () => current.onSelectSmartView("generated") },
          { id: "__reviewed_queue__", select: () => current.onSelectSmartView("reviewed") },
          { id: allFeedsId, select: () => current.onSelectFeed(allFeedsId) },
          ...current.feeds.map((feed) => ({ id: feed.id, select: () => current.onSelectFeed(feed.id) }))
        ];
        const currentTargetId = current.smartView
          ? `__${current.smartView}_queue__`
          : current.selectedFeedId;
        const currentIndex = navigationTargets.findIndex((item) => item.id === currentTargetId);
        const delta = event.key === "l" ? 1 : -1;
        const nextIndex = currentIndex < 0
          ? (delta > 0 ? 0 : navigationTargets.length - 1)
          : currentIndex + delta;
        const nextTarget = navigationTargets[nextIndex];
        if (nextTarget) {
          event.preventDefault();
          nextTarget.select();
        }
      } else if (event.key === "r" || event.key === "y") {
        event.preventDefault();
        current.onRefresh();
      } else if (event.key === "g" || event.key === "u") {
        event.preventDefault();
        if ((current.selectedThread?.posts.length ?? 0) <= 1) current.onGenerateResponses();
        else if (current.selectedThread && current.selectedThread.posts.length < 1000) current.onGenerateReplies();
      } else if (event.key === "w") {
        if (current.replyBodyRef.current && !current.replyBodyRef.current.disabled) {
          event.preventDefault();
          current.replyBodyRef.current.focus();
        }
      } else if (event.key === "b") {
        event.preventDefault();
        current.onToggleFavorite();
      } else if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (!event.repeat) current.onToggleThreadView();
      } else if ((event.key.toLowerCase() === "f" || event.key === ";") && current.threadViewMode === "browser") {
        event.preventDefault();
        if (!event.repeat) current.onToggleArticleBrowserExpanded();
      } else if (event.key === "U") {
        event.preventDefault();
        current.onToggleThreadRead();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
