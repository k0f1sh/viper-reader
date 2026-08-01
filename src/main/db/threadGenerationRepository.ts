import crypto from "node:crypto";
import type { ThreadGenerationAttempt } from "../../shared/types.js";
import { getDatabase } from "./database.js";

export function setThreadGenerationState(
  threadId: string,
  status: "queued" | "generating" | "completed" | "failed"
): void {
  const now = new Date().toISOString();
  getDatabase().prepare(`
    UPDATE feed_items SET
      generation_status = ?,
      generation_requested_at = CASE WHEN ? = 'queued' THEN ? ELSE generation_requested_at END,
      generation_completed_at = CASE WHEN ? IN ('completed', 'failed') THEN ? ELSE NULL END,
      generation_reviewed_at = CASE WHEN ? = 'queued' THEN NULL ELSE generation_reviewed_at END,
      updated_at = ?
    WHERE id = ?
  `).run(status, status, now, status, now, status, now, threadId);
}

export function startThreadGenerationAttempt(threadId: string, force: boolean, model: string): string {
  const id = `thread-generation:${crypto.randomUUID()}`;
  getDatabase().prepare(`
    INSERT INTO thread_generation_attempts
      (id, feed_item_id, status, stage, model, force, started_at)
    VALUES (?, ?, 'running', 'checking-cache', ?, ?, ?)
  `).run(id, threadId, model, force ? 1 : 0, new Date().toISOString());
  return id;
}

export function finishThreadGenerationAttempt(
  id: string,
  status: "completed" | "failed" | "skipped",
  stage: ThreadGenerationAttempt["stage"],
  errorMessage: string | null,
  technicalDetails: string | null = null
): void {
  getDatabase().prepare(`
    UPDATE thread_generation_attempts
    SET status = ?, stage = ?, error_message = ?, technical_details = ?, finished_at = ?
    WHERE id = ?
  `).run(
    status,
    stage,
    truncateGenerationError(errorMessage),
    truncateGenerationError(technicalDetails),
    new Date().toISOString(),
    id
  );
}

export function listThreadGenerationAttempts(threadId: string, limit = 5): ThreadGenerationAttempt[] {
  const safeLimit = Math.min(20, Math.max(1, Math.floor(limit)));
  const rows = getDatabase().prepare(`
    SELECT id, feed_item_id, status, stage, error_message, technical_details,
           model, force, started_at, finished_at
    FROM thread_generation_attempts
    WHERE feed_item_id = ?
    ORDER BY started_at DESC
    LIMIT ?
  `).all(threadId, safeLimit) as Array<{
    id: string;
    feed_item_id: string;
    status: ThreadGenerationAttempt["status"];
    stage: ThreadGenerationAttempt["stage"];
    error_message: string | null;
    technical_details: string | null;
    model: string;
    force: number;
    started_at: string;
    finished_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    threadId: row.feed_item_id,
    status: row.status,
    stage: row.stage,
    errorMessage: row.error_message,
    technicalDetails: row.technical_details,
    model: row.model,
    force: row.force === 1,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  }));
}

export function markThreadGenerationReviewed(threadId: string): void {
  const now = new Date().toISOString();
  getDatabase().prepare(`
    UPDATE feed_items
    SET generation_reviewed_at = COALESCE(generation_reviewed_at, ?), updated_at = ?
    WHERE id = ? AND generation_status = 'completed'
  `).run(now, now, threadId);
}

function truncateGenerationError(value: string | null): string | null {
  return value?.slice(0, 8_000) ?? null;
}
