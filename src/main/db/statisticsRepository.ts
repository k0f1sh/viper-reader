import crypto from "node:crypto";
import type {
  ApiRequestSummary,
  ArticleFetchSummary,
  RefreshFeedResult,
  RssRefreshRunSummary,
  StatisticsSummary
} from "../../shared/types.js";
import { getDatabase } from "./database.js";

export type RssRefreshRunWrite = Omit<RefreshFeedResult, "fetchedAt"> & {
  id: string;
  feedUrl: string;
  status: "success" | "error";
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
};

export type LlmRequestLogWrite = {
  id: string;
  feedId: string | null;
  purpose: string;
  model: string;
  promptHash: string;
  status: "success" | "error" | "skipped";
  requestCount: number;
  itemCount: number;
  promptChars: number;
  responseChars: number;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
  cachedContentTokenCount: number | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string;
};
type RssStatsRow = {
  total_runs: number | null;
  success_runs: number | null;
  error_runs: number | null;
  fetched_count: number | null;
  inserted_count: number | null;
  updated_count: number | null;
  skipped_count: number | null;
  converted_count: number | null;
  conversion_failed_count: number | null;
  conversion_skipped_count: number | null;
  last_finished_at: string | null;
};

type ApiStatsRow = {
  total_logs: number | null;
  request_count: number | null;
  success_logs: number | null;
  error_logs: number | null;
  skipped_logs: number | null;
  item_count: number | null;
  prompt_chars: number | null;
  response_chars: number | null;
  prompt_token_count: number | null;
  candidates_token_count: number | null;
  total_token_count: number | null;
  last_finished_at: string | null;
};

type RssRunRow = {
  id: string;
  feed_id: string;
  feed_url: string;
  status: string;
  fetched_count: number;
  inserted_count: number;
  updated_count: number;
  skipped_count: number;
  converted_count: number;
  conversion_failed_count: number;
  conversion_skipped_count: number;
  error_message: string | null;
  finished_at: string;
};

type ApiRequestRow = {
  id: string;
  feed_id: string | null;
  purpose: string;
  model: string;
  prompt_hash: string;
  status: string;
  request_count: number;
  item_count: number;
  prompt_chars: number;
  response_chars: number;
  prompt_token_count: number | null;
  candidates_token_count: number | null;
  total_token_count: number | null;
  cached_content_token_count: number | null;
  error_message: string | null;
  finished_at: string;
};
export function recordRssRefreshRun(run: RssRefreshRunWrite): void {
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO rss_refresh_runs
      (
        id,
        feed_id,
        feed_url,
        status,
        fetched_count,
        inserted_count,
        updated_count,
        skipped_count,
        converted_count,
        conversion_failed_count,
        conversion_skipped_count,
        error_message,
        started_at,
        finished_at
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    run.id,
    run.feedId,
    run.feedUrl,
    run.status,
    run.fetchedCount,
    run.insertedCount,
    run.updatedCount,
    run.skippedCount,
    run.convertedCount,
    run.conversionFailedCount,
    run.conversionSkippedCount,
    run.errorMessage,
    run.startedAt,
    run.finishedAt
  );
}

export function recordLlmRequestLog(log: LlmRequestLogWrite): void {
  const cachedHit = log.cachedContentTokenCount ? ` | CachedTokens: ${log.cachedContentTokenCount}` : "";
  console.log(
    `[LLM Request] Model: ${log.model} | Purpose: ${log.purpose} | Status: ${log.status} | Prompt Chars: ${log.promptChars} | Response Chars: ${log.responseChars} | Tokens: ${log.totalTokenCount ?? "N/A"} (prompt: ${log.promptTokenCount ?? "N/A"}, candidates: ${log.candidatesTokenCount ?? "N/A"})${cachedHit}${log.errorMessage ? ` | Error: ${log.errorMessage}` : ""}`
  );
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO llm_request_logs
      (
        id,
        feed_id,
        purpose,
        model,
        prompt_hash,
        status,
        request_count,
        item_count,
        prompt_chars,
        response_chars,
        prompt_token_count,
        candidates_token_count,
        total_token_count,
        cached_content_token_count,
        error_message,
        started_at,
        finished_at
      )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    log.id,
    log.feedId,
    log.purpose,
    log.model,
    log.promptHash,
    log.status,
    log.requestCount,
    log.itemCount,
    log.promptChars,
    log.responseChars,
    log.promptTokenCount,
    log.candidatesTokenCount,
    log.totalTokenCount,
    log.cachedContentTokenCount ?? null,
    log.errorMessage,
    log.startedAt,
    log.finishedAt
  );
}

export type ArticleFetchLogWrite = {
  feedItemId: string;
  url: string;
  status: "success" | "error" | "skipped";
  robotsResult: "allowed" | "disallowed" | "fetch_error" | "fetch_timeout";
  elapsedMs: number;
  contentSize: number;
  errorMessage: string | null;
};

export function recordArticleFetchLog(log: ArticleFetchLogWrite): void {
  console.log(
    `[Scraper] URL: ${log.url} | Status: ${log.status} | robots.txt: ${log.robotsResult} | Size: ${log.contentSize} bytes | Time: ${log.elapsedMs}ms${log.errorMessage ? ` | Error: ${log.errorMessage}` : ""}`
  );
  const db = getDatabase();
  const fetchedAt = new Date().toISOString();
  const hash = crypto
    .createHash("sha1")
    .update(`fetch:${log.feedItemId}:${fetchedAt}:${crypto.randomUUID()}`)
    .digest("hex")
    .slice(0, 20);
  const id = `fetch:${hash}`;

  db.prepare(
    `
    INSERT INTO article_fetch_logs
      (id, feed_item_id, url, status, robots_result, elapsed_ms, content_size, error_message, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
  ).run(
    id,
    log.feedItemId,
    log.url,
    log.status,
    log.robotsResult,
    log.elapsedMs,
    log.contentSize,
    log.errorMessage,
    fetchedAt
  );
}

export function getStatistics(): StatisticsSummary {
  const db = getDatabase();
  const rssRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total_runs,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_runs,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_runs,
        SUM(fetched_count) AS fetched_count,
        SUM(inserted_count) AS inserted_count,
        SUM(updated_count) AS updated_count,
        SUM(skipped_count) AS skipped_count,
        SUM(converted_count) AS converted_count,
        SUM(conversion_failed_count) AS conversion_failed_count,
        SUM(conversion_skipped_count) AS conversion_skipped_count,
        MAX(finished_at) AS last_finished_at
      FROM rss_refresh_runs
      `
    )
    .get() as RssStatsRow;
  const apiRow = db
    .prepare(
      `
      SELECT
        COUNT(*) AS total_logs,
        SUM(request_count) AS request_count,
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS success_logs,
        SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_logs,
        SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) AS skipped_logs,
        SUM(item_count) AS item_count,
        SUM(prompt_chars) AS prompt_chars,
        SUM(response_chars) AS response_chars,
        SUM(prompt_token_count) AS prompt_token_count,
        SUM(candidates_token_count) AS candidates_token_count,
        SUM(total_token_count) AS total_token_count,
        MAX(finished_at) AS last_finished_at
      FROM llm_request_logs
      `
    )
    .get() as ApiStatsRow;
  const recentRssRows = db
    .prepare(
      `
      SELECT
        id,
        feed_id,
        feed_url,
        status,
        fetched_count,
        inserted_count,
        updated_count,
        skipped_count,
        converted_count,
        conversion_failed_count,
        conversion_skipped_count,
        error_message,
        finished_at
      FROM rss_refresh_runs
      ORDER BY finished_at DESC
      LIMIT 10
      `
    )
    .all() as RssRunRow[];
  const recentApiRows = db
    .prepare(
      `
      SELECT
        id,
        feed_id,
        purpose,
        model,
        prompt_hash,
        status,
        request_count,
        item_count,
        prompt_chars,
        response_chars,
        prompt_token_count,
        candidates_token_count,
        total_token_count,
        cached_content_token_count,
        error_message,
        finished_at
      FROM llm_request_logs
      ORDER BY finished_at DESC
      LIMIT 10
      `
    )
    .all() as ApiRequestRow[];

  const recentArticleFetchRows = db
    .prepare(
      `
      SELECT
        id,
        feed_item_id,
        url,
        status,
        robots_result,
        elapsed_ms,
        content_size,
        error_message,
        fetched_at
      FROM article_fetch_logs
      ORDER BY fetched_at DESC
      LIMIT 10
      `
    )
    .all() as ArticleFetchRow[];

  return {
    rss: {
      totalRuns: Number(rssRow.total_runs ?? 0),
      successRuns: Number(rssRow.success_runs ?? 0),
      errorRuns: Number(rssRow.error_runs ?? 0),
      fetchedCount: Number(rssRow.fetched_count ?? 0),
      insertedCount: Number(rssRow.inserted_count ?? 0),
      updatedCount: Number(rssRow.updated_count ?? 0),
      skippedCount: Number(rssRow.skipped_count ?? 0),
      convertedCount: Number(rssRow.converted_count ?? 0),
      conversionFailedCount: Number(rssRow.conversion_failed_count ?? 0),
      conversionSkippedCount: Number(rssRow.conversion_skipped_count ?? 0),
      lastFinishedAt: rssRow.last_finished_at
    },
    api: {
      totalLogs: Number(apiRow.total_logs ?? 0),
      requestCount: Number(apiRow.request_count ?? 0),
      successLogs: Number(apiRow.success_logs ?? 0),
      errorLogs: Number(apiRow.error_logs ?? 0),
      skippedLogs: Number(apiRow.skipped_logs ?? 0),
      itemCount: Number(apiRow.item_count ?? 0),
      promptChars: Number(apiRow.prompt_chars ?? 0),
      responseChars: Number(apiRow.response_chars ?? 0),
      promptTokenCount: Number(apiRow.prompt_token_count ?? 0),
      candidatesTokenCount: Number(apiRow.candidates_token_count ?? 0),
      totalTokenCount: Number(apiRow.total_token_count ?? 0),
      lastFinishedAt: apiRow.last_finished_at
    },
    recentRssRuns: recentRssRows.map(rowToRssRefreshRunSummary),
    recentApiRequests: recentApiRows.map(rowToApiRequestSummary),
    recentArticleFetches: recentArticleFetchRows.map(rowToArticleFetchSummary)
  };
}
function rowToRssRefreshRunSummary(row: RssRunRow): RssRefreshRunSummary {
  return {
    id: row.id,
    feedId: row.feed_id,
    feedUrl: row.feed_url,
    status: row.status,
    fetchedCount: Number(row.fetched_count),
    insertedCount: Number(row.inserted_count),
    updatedCount: Number(row.updated_count),
    skippedCount: Number(row.skipped_count),
    convertedCount: Number(row.converted_count),
    conversionFailedCount: Number(row.conversion_failed_count),
    conversionSkippedCount: Number(row.conversion_skipped_count),
    errorMessage: row.error_message,
    finishedAt: row.finished_at
  };
}

function rowToApiRequestSummary(row: ApiRequestRow): ApiRequestSummary {
  return {
    id: row.id,
    feedId: row.feed_id,
    purpose: row.purpose,
    model: row.model,
    promptHash: row.prompt_hash,
    status: row.status,
    requestCount: Number(row.request_count),
    itemCount: Number(row.item_count),
    promptChars: Number(row.prompt_chars),
    responseChars: Number(row.response_chars),
    promptTokenCount: row.prompt_token_count,
    candidatesTokenCount: row.candidates_token_count,
    totalTokenCount: row.total_token_count,
    cachedContentTokenCount: row.cached_content_token_count,
    errorMessage: row.error_message,
    finishedAt: row.finished_at
  };
}

type ArticleFetchRow = {
  id: string;
  feed_item_id: string | null;
  url: string;
  status: string;
  robots_result: string;
  elapsed_ms: number;
  content_size: number;
  error_message: string | null;
  fetched_at: string;
};

function rowToArticleFetchSummary(row: ArticleFetchRow): ArticleFetchSummary {
  return {
    id: row.id,
    feedItemId: row.feed_item_id,
    url: row.url,
    status: row.status,
    robotsResult: row.robots_result,
    elapsedMs: Number(row.elapsed_ms),
    contentSize: Number(row.content_size),
    errorMessage: row.error_message,
    fetchedAt: row.fetched_at
  };
}
