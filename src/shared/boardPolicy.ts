import type { BoardKind, ThreadDetail } from "./types.js";

type Board = { kind: BoardKind };

export function isRssBoard<T extends Board>(board: T | null | undefined): board is T & { kind: "rss" } {
  return board?.kind === "rss";
}

export function isLocalBoard<T extends Board>(board: T | null | undefined): board is T & { kind: "local" } {
  return board?.kind === "local";
}

export function needsArticleSummary(thread: Pick<ThreadDetail, "kind" | "url">): boolean {
  return isRssBoard(thread) || Boolean(thread.url);
}

export function canUseThreadPane(thread: ThreadDetail | null | undefined): thread is ThreadDetail {
  return Boolean(thread && (isLocalBoard(thread) || thread.posts.length > 1));
}
