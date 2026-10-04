import crypto from "node:crypto";
import { localBoardId, type CreateLocalThreadRequest, type CreateLocalThreadResult } from "../../shared/types.js";
import { getDatabase } from "../db/database.js";
import { getThread } from "../db/threadRepository.js";
import { postUserMessage } from "../db/threadPostRepository.js";
import { saveArticleBody, saveArticleSummary, getArticleSummary } from "../db/articleRepository.js";
import { recordArticleFetchLog, recordLlmRequestLog } from "../db/repository.js";
import { canonicalizeArticleUrl } from "../articles/canonicalUrl.js";
import { scrapeArticle } from "../scraper/articleScraper.js";
import { generateArticleSummary } from "../ai/summaryGenerator.js";
import { formatBoardDate } from "./boardDate.js";
import { saveLocalArticleSummaryPost, ensureLocalArticleSummaryPost } from "./localArticleSummaryPost.js";
import { getUserBoardId } from "./postMessage.js";

export async function createLocalThread(request: CreateLocalThreadRequest): Promise<CreateLocalThreadResult> {
  if (!request || typeof request.title !== "string" || !request.title.trim() || request.title.length > 200) {
    throw new Error("タイトルを200文字以内で入力してください。");
  }
  if (request.mode !== "text" && request.mode !== "url") throw new Error("入力方法が不正です。");
  const db = getDatabase();
  let sourceUrl: string | null = null;
  let body: string;
  let summary: string | null = null;
  if (request.mode === "text") {
    if (typeof request.body !== "string" || !request.body.trim() || request.body.length > 10_000) {
      throw new Error("記事本文を10,000文字以内で入力してください。");
    }
    body = request.body;
  } else {
    if (typeof request.url !== "string" || request.url.length > 2048) throw new Error("記事URLが不正です。");
    let parsed: URL;
    try { parsed = new URL(request.url); } catch { throw new Error("記事URLが不正です。"); }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("認証情報を含まないHTTPまたはHTTPS URLを指定してください。");
    }
    sourceUrl = canonicalizeArticleUrl(parsed.href);
    // Check the shared SQLite article cache before fetching or summarizing.
    const cached = db.prepare(`SELECT ab.content_text, ab.summary_text FROM article_bodies ab
      JOIN feed_items fi ON fi.id = ab.feed_item_id
      WHERE COALESCE(fi.source_url, NULLIF(fi.canonical_url, ''), fi.url) = ?
      ORDER BY ab.fetched_at DESC, ab.rowid DESC LIMIT 1
    `).get(sourceUrl) as { content_text: string; summary_text: string | null } | undefined;
    if (cached) {
      body = cached.content_text;
      summary = cached.summary_text;
    } else {
      const result = await scrapeArticle(sourceUrl);
      recordArticleFetchLog({ feedItemId: null, url: sourceUrl,
        status: result.success ? "success" : "error", robotsResult: result.robotsResult,
        elapsedMs: result.elapsedMs, contentSize: result.contentSize, errorMessage: result.reason ?? null });
      if (!result.success || !result.contentText.trim()) {
        throw new Error(`記事本文を取得できませんでした（${result.reason ?? "no_content"}）。本文を直接入力するか、URLを確認してください。`);
      }
      body = result.contentText;
    }
  }
  const id = `local:${crypto.randomUUID()}`;
  const now = new Date();
  const timestamp = now.toISOString();
  // Keep local conversations and their saved article snapshots independent of RSS updates.
  const internalUrl = `viper-local://thread/${id}`;
  db.exec("BEGIN");
  try {
    db.prepare(`INSERT INTO feed_items
      (id, feed_id, title, url, source_url, raw_summary, published_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, localBoardId, request.title.trim(), internalUrl, sourceUrl, body, timestamp, timestamp, timestamp);
    postUserMessage({ feedItemId: id, no: 1, name: "名無しさん", mail: null,
      date: formatBoardDate(now), uid: getUserBoardId(), body: sourceUrl ? `元記事タイトル:\n${request.title.trim()}\n\nURL:\n${sourceUrl}` : body });
    saveArticleBody(id, sourceUrl ?? internalUrl, body);
    if (summary) saveArticleSummary(id, summary);
    if (sourceUrl) saveLocalArticleSummaryPost(id, null);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  let warning: string | null = null;
  if (sourceUrl && !summary) {
    try {
      const result = await generateArticleSummary(id, localBoardId, body);
      if (result.log) recordLlmRequestLog(result.log);
      if (result.summary) {
        saveArticleSummary(id, result.summary);
      }
      else warning = `記事本文は保存しましたが、要約できませんでした。${result.log?.errorMessage ?? "返信生成時に再試行します。"}`;
    } catch (error) {
      warning = `記事本文は保存しましたが、要約できませんでした。${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (sourceUrl && getArticleSummary(id)) {
    try { await ensureLocalArticleSummaryPost(id); }
    catch (error) { warning = `記事本文と要約は保存しましたが、要約レスを生成できませんでした。${error instanceof Error ? error.message : String(error)}`; }
  }
  const thread = getThread(id);
  if (!thread) throw new Error("スレッドを保存できませんでした。");
  return { thread, warning };
}
