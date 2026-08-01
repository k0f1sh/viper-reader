import crypto from "node:crypto";
import type { ThreadDetail } from "../../shared/types.js";
import { generateReplyPosts, type ReplyGenerationMode } from "../ai/replyGenerator.js";
import {
  getThread,
  postUserMessage,
  recordLlmRequestLog,
  saveGeneratedThreadPosts,
  getArticleBody,
  getArticleSummary,
  saveArticleSummary,
  markLatestReplyRunContinued,
  recordReplyGenerationRun
} from "../db/repository.js";
import { generateArticleSummary } from "../ai/summaryGenerator.js";
import { acquireThreadLock, releaseThreadLock } from "./threadLocks.js";
import { formatBoardDate } from "./boardDate.js";

type PostStatusCallback = (
  status: "writing" | "generating" | "done" | "error",
  errorMessage?: string
) => void;

export async function postThreadMessage(
  threadId: string,
  name: string,
  mail: string,
  body: string,
  onStatus?: PostStatusCallback
): Promise<ThreadDetail | null> {
  if (
    typeof threadId !== "string"
    || !threadId
    || typeof name !== "string"
    || typeof mail !== "string"
    || typeof body !== "string"
    || !body.trim()
  ) {
    throw new Error("書き込み内容が不正です。");
  }
  if (threadId.length > 512 || name.length > 80 || mail.length > 20 || body.length > 10_000) {
    throw new Error("書き込み内容が長すぎます。");
  }

  if (!acquireThreadLock(threadId)) {
    onStatus?.("error");
    throw new Error("このスレッドは現在処理中です。完了してからもう一度試してください。");
  }

  try {
    const thread = getThread(threadId);
    if (!thread) {
      onStatus?.("error");
      releaseThreadLock(threadId);
      return null;
    }

    const maxNo = getMaxPostNo(thread);

    // 1000レス上限チェック
    if (maxNo >= 1000) {
      onStatus?.("error");
      throw new Error("このスレッドは1000レスに達したため書き込めません。");
    }

    onStatus?.("writing");

    const nextNo = maxNo + 1;
    const dateStr = formatBoardDate(new Date());
    const uid = getUserBoardId();

    // ユーザーのレスをDBに保存
    postUserMessage({
      feedItemId: threadId,
      no: nextNo,
      name: name.trim() ? name.trim() : "名無しさん",
      mail: mail.trim() ? mail.trim() : null,
      date: dateStr,
      uid,
      body: body
    });
    markLatestReplyRunContinued(threadId, "user");

    // 最新状態を取得
    const updatedThread = getThread(threadId);
    if (!updatedThread) {
      onStatus?.("error");
      releaseThreadLock(threadId);
      return null;
    }

    // レス数が1000に達した場合
    if (getMaxPostNo(updatedThread) >= 1000) {
      onStatus?.("done");
      releaseThreadLock(threadId);
      return updatedThread;
    }

    onStatus?.("generating");
    void completePostGeneration(threadId, updatedThread, onStatus);
    return updatedThread;
  } catch (error) {
    onStatus?.("error");
    releaseThreadLock(threadId);
    throw error;
  }
}

async function completePostGeneration(
  threadId: string,
  thread: ThreadDetail,
  onStatus?: PostStatusCallback
): Promise<void> {
  try {
    await ensureArticleSummary(threadId, thread.feedId);
    await generateAndSaveReplies(threadId, thread, "reply_to_user");
    onStatus?.("done");
  } catch (error) {
    console.error("AI自動返信の生成中にエラーが発生しました:", error);
    onStatus?.("error", error instanceof Error ? error.message : String(error));
  } finally {
    releaseThreadLock(threadId);
  }
}

function getUserBoardId(): string {
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const hash = crypto.createHash("sha1").update(`${dateStr}:viper-user-salt`).digest("hex");
  return hash.slice(0, 8);
}

export async function generateRepliesOnly(
  threadId: string,
  onStatus?: PostStatusCallback
): Promise<ThreadDetail | null> {
  if (!acquireThreadLock(threadId)) {
    onStatus?.("done");
    return getThread(threadId);
  }

  try {
    const thread = getThread(threadId);
    if (!thread) {
      onStatus?.("error");
      return null;
    }

    await ensureArticleSummary(threadId, thread.feedId);

    const maxNo = getMaxPostNo(thread);

    // 1000レス上限チェック
    if (maxNo >= 1000) {
      onStatus?.("error");
      throw new Error("このスレッドは1000レスに達したため書き込めません。");
    }

    onStatus?.("generating");
    markLatestReplyRunContinued(threadId, "thread");
    await generateAndSaveReplies(threadId, thread, "continue_thread");
    onStatus?.("done");
  } catch (error) {
    console.error("AI自動返信の生成中にエラーが発生しました:", error);
    onStatus?.("error", error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    releaseThreadLock(threadId);
  }

  return getThread(threadId);
}

async function ensureArticleSummary(threadId: string, feedId: string): Promise<void> {
  // 初回レス生成時に、要約がなければ生成して保存する
  try {
    const summary = getArticleSummary(threadId);
    if (summary) {
      return;
    }

    const fullBody = getArticleBody(threadId);
    if (!fullBody) {
      return;
    }

    const generated = await generateArticleSummary(threadId, feedId, fullBody);
    if (generated.log) {
      recordLlmRequestLog(generated.log);
    }
    if (generated.summary) {
      saveArticleSummary(threadId, generated.summary);
    }
  } catch (err) {
    console.error("要約生成中にエラーが発生しました（処理は継続します）:", err);
  }
}

async function generateAndSaveReplies(
  threadId: string,
  thread: ThreadDetail,
  mode: ReplyGenerationMode
): Promise<void> {
  const aiResult = await generateReplyPosts(thread, { mode });
  if (aiResult.log) {
    recordLlmRequestLog(aiResult.log);
  }

  if (aiResult.log?.errorMessage) {
    throw new Error(aiResult.log.errorMessage);
  }
  if (aiResult.posts.length === 0) {
    throw new Error("Geminiから返信レスを取得できませんでした。");
  }

  const maxNo = getMaxPostNo(thread);
  const postsToSave = fitPostsUnderLimit(aiResult.posts, maxNo);
  if (postsToSave.length > 0) {
    saveGeneratedThreadPosts(threadId, postsToSave);
    recordReplyGenerationRun({
      id: `reply-run:${crypto.randomUUID()}`,
      feedId: thread.feedId,
      threadId,
      mode,
      model: aiResult.model,
      promptVersionId: aiResult.promptVersionId,
      promptHash: aiResult.promptHash,
      startNo: postsToSave[0].no,
      endNo: postsToSave[postsToSave.length - 1].no
    });
  }
}

function fitPostsUnderLimit(posts: ThreadDetail["posts"], maxNo: number): ThreadDetail["posts"] {
  if (maxNo + posts.length < 1000) {
    return posts;
  }

  const allowedCount = Math.max(0, 1000 - maxNo - 1);
  const postsToSave = posts.slice(0, allowedCount);
  postsToSave.push(createOver1000Post());
  return postsToSave;
}

function createOver1000Post(): ThreadDetail["posts"][number] {
  return {
    no: 1000,
    name: "１０００しかなかったよ",
    mail: "over1000",
    date: formatBoardDate(new Date()),
    id: "Over1000Id",
    body: "このスレッドは１０００を超えました。\nもう書けないので、新しいスレッドを立ててください。"
  };
}

function getMaxPostNo(thread: ThreadDetail): number {
  return thread.posts.reduce((max, p) => Math.max(max, p.no), 0);
}
