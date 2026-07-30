import type { ThreadDetail, ThreadGenerationProgress } from "../../shared/types.js";
import { generateThreadResponses } from "../ai/threadResponseGenerator.js";
import {
  getArticleBody,
  getArticleSummary,
  getThread,
  finishThreadGenerationAttempt,
  recordLlmRequestLog,
  recordArticleFetchLog,
  saveArticleBody,
  saveThreadResponsePosts,
  startThreadGenerationAttempt
} from "../db/repository.js";
import { getFeedResidentPrompt } from "../db/residentPromptRepository.js";
import { buildVipThreadResponsePromptHash } from "../prompts/vipThreadResponsePrompt.js";
import { scrapeArticle } from "../scraper/articleScraper.js";
import { getActiveModel } from "../settings/settingsService.js";
import { acquireThreadLock, releaseThreadLock } from "./threadLocks.js";

export function openThread(threadId: string): ThreadDetail | null {
  return getThread(threadId);
}

export function startThreadResponseGeneration(
  threadId: string,
  force: boolean,
  onComplete: (status: "done" | "skipped" | "error") => void,
  onProgress: (progress: Omit<ThreadGenerationProgress, "threadId">) => void = () => undefined
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

  const attemptId = startThreadGenerationAttempt(threadId, force, getActiveModel());
  let currentStage: ThreadGenerationProgress["stage"] = "checking-cache";
  const reportProgress = (progress: Omit<ThreadGenerationProgress, "threadId">): void => {
    currentStage = progress.stage;
    onProgress(progress);
  };

  void (async () => {
    try {
      reportProgress({ stage: "checking-cache", message: "記事キャッシュを確認中..." });
      const scrapedBody = await getOrScrapeArticleBody(thread, reportProgress);

      reportProgress({ stage: "preparing-context", message: "記事内容をAI向けに整形中..." });
      const articleSummary = getArticleSummary(threadId);
      const result = await generateAndSaveThreadResponses(thread, scrapedBody, articleSummary, reportProgress);
      finishThreadGenerationAttempt(
        attemptId,
        result.status === "done" ? "completed" : result.status === "error" ? "failed" : "skipped",
        currentStage,
        result.errorMessage
      );
      onComplete(result.status);
    } catch (error) {
      console.error(`レス生成でエラーが発生しました (threadId: ${threadId})`, error);
      finishThreadGenerationAttempt(
        attemptId,
        "failed",
        currentStage,
        error instanceof Error ? error.message : "予期しないエラーが発生しました。",
        error instanceof Error ? error.stack ?? error.message : String(error)
      );
      onComplete("error");
    } finally {
      releaseThreadLock(threadId);
    }
  })();
}

async function getOrScrapeArticleBody(
  thread: ThreadDetail,
  onProgress: (progress: Omit<ThreadGenerationProgress, "threadId">) => void
): Promise<string | null> {
  let scrapedBody = getArticleBody(thread.id);
  if (scrapedBody) {
    return scrapedBody;
  }

  onProgress({ stage: "fetching-article", message: "元記事を取得・本文抽出中..." });
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
  articleSummary: string | null,
  onProgress: (progress: Omit<ThreadGenerationProgress, "threadId">) => void
): Promise<{ status: "done" | "skipped" | "error"; errorMessage: string | null }> {
  const residentPrompt = getFeedResidentPrompt(thread.feedId);
  const promptHash = buildVipThreadResponsePromptHash(residentPrompt?.promptHash ?? null);
  onProgress({ stage: "generating-posts", message: "AI住民が >>2 以降のレスを生成中..." });
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
    return generated.log.errorMessage
      ? { status: "error", errorMessage: generated.log.errorMessage }
      : { status: "skipped", errorMessage: null };
  }
  if (generated.log?.status === "error") {
    return { status: "error", errorMessage: generated.log.errorMessage ?? "AIレスの生成に失敗しました。" };
  }

  if (generated.posts.length > 0) {
    onProgress({ stage: "saving-posts", message: "生成したレスを保存中..." });
    saveThreadResponsePosts(
      {
        feedItemId: thread.id,
        posts: generated.posts
      },
      getActiveModel(),
      promptHash
    );
    return { status: "done", errorMessage: null };
  }

  return { status: "skipped", errorMessage: null };
}
