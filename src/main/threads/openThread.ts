import type { ThreadDetail } from "../../shared/types.js";
import { generateThreadResponses } from "../ai/threadResponseGenerator.js";
import {
  getArticleBody,
  getFeedResidentPrompt,
  getThread,
  recordLlmRequestLog,
  recordArticleFetchLog,
  saveArticleBody,
  saveThreadResponsePosts,
  getActiveModel
} from "../db/repository.js";
import { buildVipThreadResponsePromptHash } from "../prompts/vipThreadResponsePrompt.js";
import { scrapeArticle } from "../scraper/articleScraper.js";

const generatingThreadIds = new Set<string>();

export function openThread(threadId: string): ThreadDetail | null {
  return getThread(threadId);
}

export function startThreadResponseGeneration(
  threadId: string,
  force: boolean,
  onComplete: (status: "done" | "skipped" | "error") => void
): void {
  const thread = getThread(threadId);
  if (!thread || (!force && thread.posts.length > 1) || generatingThreadIds.has(threadId)) {
    return;
  }

  generatingThreadIds.add(threadId);

  void (async () => {
    try {
      // 1. 本文キャッシュの確認
      let scrapedBody = getArticleBody(threadId);

      // 2. キャッシュにない場合はスクレイピングして保存
      if (!scrapedBody) {
        const scrapeResult = await scrapeArticle(thread.url);

        // 元記事の取得履歴を記録
        recordArticleFetchLog({
          feedItemId: threadId,
          url: thread.url,
          status: scrapeResult.success ? "success" : "error",
          robotsResult: scrapeResult.robotsResult,
          elapsedMs: scrapeResult.elapsedMs,
          contentSize: scrapeResult.contentSize,
          errorMessage: scrapeResult.reason || null
        });

        if (scrapeResult.success) {
          scrapedBody = scrapeResult.contentText;
          saveArticleBody(threadId, thread.url, scrapedBody);
        } else {
          console.warn(`スクレイピングをスキップまたは失敗したため、RSS要約を使用します: ${scrapeResult.reason}`);
        }
      }

      // 3. レスの生成・保存
      const status = await generateAndSaveThreadResponses(thread, scrapedBody);
      onComplete(status);
    } catch (error) {
      console.error(`レス生成でエラーが発生しました (threadId: ${threadId})`, error);
      onComplete("error");
    } finally {
      generatingThreadIds.delete(threadId);
    }
  })();
}

async function generateAndSaveThreadResponses(
  thread: ThreadDetail,
  scrapedBody: string | null
): Promise<"done" | "skipped" | "error"> {
  const residentPrompt = getFeedResidentPrompt(thread.feedId);
  const promptHash = buildVipThreadResponsePromptHash(residentPrompt?.promptHash ?? null);
  const generated = await generateThreadResponses(thread, {
    residentPrompt: residentPrompt?.prompt ?? null,
    promptHash,
    scrapedBody
  });
  if (generated.log) {
    recordLlmRequestLog(generated.log);
  }

  if (generated.log?.status === "skipped") {
    return "skipped";
  }
  if (generated.log?.status === "error") {
    return "error";
  }

  if (generated.posts.length > 0) {
    saveThreadResponsePosts(
      {
        feedItemId: thread.id,
        posts: generated.posts
      },
      getActiveModel(),
      promptHash
    );
    return "done";
  }

  return "skipped";
}
