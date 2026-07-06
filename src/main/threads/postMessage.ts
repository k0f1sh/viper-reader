import crypto from "node:crypto";
import type { ThreadDetail } from "../../shared/types.js";
import { generateReplyPosts } from "../ai/replyGenerator.js";
import {
  getThread,
  postUserMessage,
  saveGeneratedThreadPosts,
  getArticleBody,
  getArticleSummary,
  saveArticleSummary
} from "../db/repository.js";
import { generateArticleSummary } from "../ai/summaryGenerator.js";

export async function postThreadMessage(
  threadId: string,
  name: string,
  mail: string,
  body: string,
  onStatus?: (status: "writing" | "generating" | "done" | "error") => void
): Promise<ThreadDetail | null> {
  const thread = getThread(threadId);
  if (!thread) {
    onStatus?.("error");
    return null;
  }

  // 初回書き込み時に、要約がなければ生成して保存する
  try {
    const summary = getArticleSummary(threadId);
    if (!summary) {
      const fullBody = getArticleBody(threadId);
      if (fullBody) {
        const generatedSummary = await generateArticleSummary(threadId, thread.feedId, fullBody);
        if (generatedSummary) {
          saveArticleSummary(threadId, generatedSummary);
        }
      }
    }
  } catch (err) {
    console.error("要約生成中にエラーが発生しました（処理は継続します）:", err);
  }

  const maxNo = thread.posts.reduce((max, p) => Math.max(max, p.no), 0);

  // 1000レス上限チェック
  if (maxNo >= 1000) {
    onStatus?.("error");
    throw new Error("このスレッドは1000レスに達したため書き込めません。");
  }

  onStatus?.("writing");

  const nextNo = maxNo + 1;
  const dateStr = formatVipDate(new Date());
  const uid = getUserVipId();

  // ユーザーのレスをDBに保存
  postUserMessage({
    feedItemId: threadId,
    no: nextNo,
    name: name.trim() ? name.trim() : "以下、名無しにかわりましてVIPがお送りします",
    mail: mail.trim() ? mail.trim() : null,
    date: dateStr,
    uid,
    body: body
  });

  // 最新状態を取得
  let updatedThread = getThread(threadId);
  if (!updatedThread) {
    onStatus?.("error");
    return null;
  }

  const updatedMaxNo = updatedThread.posts.reduce((max, p) => Math.max(max, p.no), 0);

  // レス数が1000に達した場合
  if (updatedMaxNo >= 1000) {
    onStatus?.("done");
    return updatedThread;
  }

  onStatus?.("generating");

  // AIによる自動返信レスの生成
  try {
    const aiResult = await generateReplyPosts(updatedThread);
    if (aiResult.posts.length > 0) {
      let postsToSave = aiResult.posts;

      // 1000レス上限に収まるようにトリミングし、埋め用レスを追加する
      if (updatedMaxNo + postsToSave.length >= 1000) {
        const allowedCount = 1000 - updatedMaxNo - 1; // 1000番目を埋めレスにするため -1
        postsToSave = postsToSave.slice(0, allowedCount);

        // 1000番目の埋めレスを追加
        const fillPostNo = 1000;
        postsToSave.push({
          no: fillPostNo,
          name: "１０００しかなかったよ",
          mail: "over1000",
          date: formatVipDate(new Date()),
          id: "Over1000Id",
          body: "このスレッドは１０００を超えました。\nもう書けないので、新しいスレッドを立ててください。"
        });
      }

      saveGeneratedThreadPosts(threadId, postsToSave);
    }
  } catch (error) {
    console.error("AI自動返信の生成中にエラーが発生しました:", error);
  }

  onStatus?.("done");
  return getThread(threadId);
}

function getUserVipId(): string {
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const hash = crypto.createHash("sha1").update(`${dateStr}:viper-user-salt`).digest("hex");
  return hash.slice(0, 8);
}

function formatVipDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const day = days[date.getDay()];
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  const ms = String(Math.floor(date.getMilliseconds() / 10)).padStart(2, "0");
  return `${y}/${m}/${d}(${day}) ${hh}:${mm}:${ss}.${ms}`;
}

export async function generateRepliesOnly(
  threadId: string,
  onStatus?: (status: "writing" | "generating" | "done" | "error") => void
): Promise<ThreadDetail | null> {
  const thread = getThread(threadId);
  if (!thread) {
    onStatus?.("error");
    return null;
  }

  // 手動レス生成時にも、要約がなければ生成して保存する
  try {
    const summary = getArticleSummary(threadId);
    if (!summary) {
      const fullBody = getArticleBody(threadId);
      if (fullBody) {
        const generatedSummary = await generateArticleSummary(threadId, thread.feedId, fullBody);
        if (generatedSummary) {
          saveArticleSummary(threadId, generatedSummary);
        }
      }
    }
  } catch (err) {
    console.error("要約生成中にエラーが発生しました（処理は継続します）:", err);
  }

  const maxNo = thread.posts.reduce((max, p) => Math.max(max, p.no), 0);

  // 1000レス上限チェック
  if (maxNo >= 1000) {
    onStatus?.("error");
    throw new Error("このスレッドは1000レスに達したため書き込めません。");
  }

  onStatus?.("generating");

  try {
    const aiResult = await generateReplyPosts(thread);
    if (aiResult.posts.length > 0) {
      let postsToSave = aiResult.posts;

      // 1000レス上限に収まるようにトリミングし、埋め用レスを追加する
      if (maxNo + postsToSave.length >= 1000) {
        const allowedCount = 1000 - maxNo - 1; // 1000番目を埋めレスにするため -1
        postsToSave = postsToSave.slice(0, allowedCount);

        // 1000番目の埋めレスを追加
        const fillPostNo = 1000;
        postsToSave.push({
          no: fillPostNo,
          name: "１０００しかなかったよ",
          mail: "over1000",
          date: formatVipDate(new Date()),
          id: "Over1000Id",
          body: "このスレッドは１０００を超えました。\nもう書けないので、新しいスレッドを立ててください。"
        });
      }

      saveGeneratedThreadPosts(threadId, postsToSave);
    }
    onStatus?.("done");
  } catch (error) {
    console.error("AI自動返信の生成中にエラーが発生しました:", error);
    onStatus?.("error");
  }

  return getThread(threadId);
}
