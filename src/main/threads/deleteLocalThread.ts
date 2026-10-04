import { isLocalBoard } from "../../shared/boardPolicy.js";
import { getDatabase } from "../db/database.js";
import { getThread } from "../db/threadRepository.js";
import { acquireThreadLock, releaseThreadLock } from "./threadLocks.js";

export function deleteLocalThread(threadId: string): void {
  if (!acquireThreadLock(threadId)) {
    throw new Error("このスレッドは現在処理中です。完了してからもう一度試してください。");
  }
  try {
    const thread = getThread(threadId);
    if (!thread) throw new Error("スレッドが見つかりません。");
    if (!isLocalBoard(thread)) throw new Error("スレ削除は自由板でのみ利用できます。");
    // Foreign keys remove posts, body snapshots and generation records for this thread only.
    getDatabase().prepare("DELETE FROM feed_items WHERE id = ?").run(threadId);
  } finally {
    releaseThreadLock(threadId);
  }
}
