import crypto from "node:crypto";
import { getDatabase } from "../db/database.js";
import { getThread } from "../db/threadRepository.js";
import { getArticleBody, getArticleSummary } from "../db/articleRepository.js";
import { recordLlmRequestLog } from "../db/statisticsRepository.js";
import { getFeedResidentPrompt } from "../db/residentPromptRepository.js";
import { generateThreadResponses } from "../ai/threadResponseGenerator.js";
import { buildBoardThreadResponsePromptHash } from "../prompts/threadResponsePrompt.js";
import { isLocalBoard } from "../../shared/boardPolicy.js";
import { formatBoardDate } from "./boardDate.js";

const pendingSummaryBody = ">>1\n記事は取得できたけど、要約はまだできてない。本文は「記事本文」で読めるよ。返信生成で再試行してくれ。";

/** Reserve response 2 for the URL article summary without replacing existing conversation posts. */
export function saveLocalArticleSummaryPost(threadId: string, postBody: string | null): void {
  const db = getDatabase();
  const source = db.prepare(`SELECT fi.source_url FROM feed_items fi
    JOIN feed_sources fs ON fs.id = fi.feed_id WHERE fi.id = ? AND fs.kind = 'local'
  `).get(threadId);
  if (!source?.source_url) return;
  const uid = crypto.createHash("sha256").update(`local-summary:${threadId}`).digest("hex").slice(0, 8);
  const now = new Date();
  const body = postBody ?? pendingSummaryBody;
  db.prepare(`INSERT INTO thread_posts
    (id, feed_item_id, no, name, mail, date, uid, body, is_user, created_at)
    VALUES (?, ?, 2, '名無しさん', 'sage', ?, ?, ?, 0, ?)
    ON CONFLICT(feed_item_id, no) DO UPDATE SET body = excluded.body
    WHERE thread_posts.is_user = 0 AND thread_posts.uid = excluded.uid
  `).run(`post:${threadId}:2`, threadId, formatBoardDate(now), uid, body, now.toISOString());
}

/** Use the ordinary article response generator to turn the cached summary into resident speech. */
export async function ensureLocalArticleSummaryPost(threadId: string): Promise<void> {
  const thread = getThread(threadId);
  if (!isLocalBoard(thread) || !thread.url) return;
  const summary = getArticleSummary(threadId);
  if (!summary) return;
  const existing = thread.posts.find((post) => post.no === 2);
  const uid = crypto.createHash("sha256").update(`local-summary:${threadId}`).digest("hex").slice(0, 8);
  if (existing && (existing.isUser || existing.id !== uid)) return;
  // Keep completed speech; also migrate the former raw-summary response on retry.
  if (existing && existing.body !== `>>1\n${summary}` && existing.body !== pendingSummaryBody) return;
  const residents = getFeedResidentPrompt(thread.feedId);
  const generated = await generateThreadResponses(thread, {
    residentPrompt: residents?.prompt ?? null,
    promptHash: buildBoardThreadResponsePromptHash(residents?.promptHash ?? null, true),
    scrapedBody: getArticleBody(threadId), articleSummary: summary, summaryOnly: true
  });
  if (generated.log) recordLlmRequestLog(generated.log);
  if (!generated.posts[0] || generated.log?.errorMessage) {
    throw new Error(generated.log?.errorMessage ?? "要約レスを生成できませんでした。");
  }
  saveLocalArticleSummaryPost(threadId, generated.posts[0].body);
}
