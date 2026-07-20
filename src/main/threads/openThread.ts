import type { ThreadDetail } from "../../shared/types.js";
import { generateExpertExplanation, expertExplanationModel } from "../ai/expertExplanationGenerator.js";
import { generateThreadResponses } from "../ai/threadResponseGenerator.js";
import {
  getArticleBody,
  getArticleSummary,
  getFeedResidentPrompt,
  getThread,
  recordLlmRequestLog,
  recordArticleFetchLog,
  saveArticleBody,
  saveThreadResponsePosts
} from "../db/repository.js";
import { buildVipThreadResponsePromptHash } from "../prompts/vipThreadResponsePrompt.js";
import { vipExpertExplanationPromptHash } from "../prompts/vipExpertExplanationPrompt.js";
import { scrapeArticle } from "../scraper/articleScraper.js";
import { getActiveModel } from "../settings/settingsService.js";
import { acquireThreadLock, releaseThreadLock } from "./threadLocks.js";

export function openThread(threadId: string): ThreadDetail | null {
  return getThread(threadId);
}

export function startThreadResponseGeneration(
  threadId: string,
  force: boolean,
  onComplete: (status: "done" | "skipped" | "error") => void
): void {
  const thread = getThread(threadId);
  if (!thread) {
    onComplete("error");
    return;
  }
  if (!force && thread.posts.length > 1) {
    onComplete("skipped");
    return;
  }
  if (!acquireThreadLock(threadId)) {
    onComplete("skipped");
    return;
  }

  void (async () => {
    try {
      const scrapedBody = await getOrScrapeArticleBody(thread);

      // 3. レスの生成・保存
      const articleSummary = getArticleSummary(threadId);
      const status = await generateAndSaveThreadResponses(thread, scrapedBody, articleSummary);
      onComplete(status);
    } catch (error) {
      console.error(`レス生成でエラーが発生しました (threadId: ${threadId})`, error);
      onComplete("error");
    } finally {
      releaseThreadLock(threadId);
    }
  })();
}

export function startExpertExplanationGeneration(
  threadId: string,
  onComplete: (status: "done" | "skipped" | "error") => void
): void {
  const thread = getThread(threadId);
  if (!thread || thread.posts.length > 1 || !acquireThreadLock(threadId)) {
    onComplete("skipped");
    return;
  }

  void (async () => {
    try {
      const scrapedBody = await getOrScrapeArticleBody(thread);
      const generated = await generateExpertExplanation(thread, scrapedBody, vipExpertExplanationPromptHash);
      recordLlmRequestLog(generated.log);
      if (generated.log.status !== "success" || generated.posts.length === 0) {
        onComplete(generated.log.status === "error" ? "error" : "skipped");
        return;
      }
      saveThreadResponsePosts(
        { feedItemId: thread.id, posts: generated.posts },
        expertExplanationModel,
        vipExpertExplanationPromptHash
      );
      onComplete("done");
    } catch (error) {
      console.error(`有識者解説の生成でエラーが発生しました (threadId: ${threadId})`, error);
      onComplete("error");
    } finally {
      releaseThreadLock(threadId);
    }
  })();
}

async function getOrScrapeArticleBody(thread: ThreadDetail): Promise<string | null> {
  let scrapedBody = getArticleBody(thread.id);
  if (scrapedBody) {
    return scrapedBody;
  }

  const scrapeResult = await scrapeArticle(thread.url);
  recordArticleFetchLog({
    feedItemId: thread.id,
    url: thread.url,
    status: scrapeResult.success ? "success" : "error",
    robotsResult: scrapeResult.robotsResult,
    elapsedMs: scrapeResult.elapsedMs,
    contentSize: scrapeResult.contentSize,
    errorMessage: scrapeResult.reason || null
  });

  if (!scrapeResult.success) {
    console.warn(`スクレイピングをスキップまたは失敗したため、RSS要約を使用します: ${scrapeResult.reason}`);
    return null;
  }

  scrapedBody = scrapeResult.contentText;
  saveArticleBody(thread.id, thread.url, scrapedBody);
  return scrapedBody;
}

async function generateAndSaveThreadResponses(
  thread: ThreadDetail,
  scrapedBody: string | null,
  articleSummary: string | null = null
): Promise<"done" | "skipped" | "error"> {
  const residentPrompt = getFeedResidentPrompt(thread.feedId);
  const promptHash = buildVipThreadResponsePromptHash(residentPrompt?.promptHash ?? null);
  const generated = await generateThreadResponses(thread, {
    residentPrompt: residentPrompt?.prompt ?? null,
    promptHash,
    scrapedBody,
    articleSummary
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
