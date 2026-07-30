import crypto from "node:crypto";
import type {
  FeedResidentPrompt,
  ReplyRating,
  ResidentPromptVersion
} from "../../shared/types.js";
import { getDatabase } from "./database.js";

export type FeedResident = {
  id: string;
  key: string;
  stableUid: string;
  traits: string;
};

export function getFeedResidentPrompt(feedId: string): FeedResidentPrompt | null {
  const row = getDatabase().prepare(`
    SELECT feed_id, prompt, prompt_hash, updated_at
    FROM feed_resident_prompts
    WHERE feed_id = ?
  `).get(feedId) as {
    feed_id: string;
    prompt: string;
    prompt_hash: string;
    updated_at: string;
  } | undefined;

  if (!row) return null;

  return {
    feedId: row.feed_id,
    prompt: row.prompt,
    promptHash: row.prompt_hash,
    updatedAt: row.updated_at
  };
}

export function saveFeedResidentPrompt(feedId: string, promptText: string): void {
  if (typeof feedId !== "string" || !feedId || feedId.length > 512 || typeof promptText !== "string") {
    throw new Error("Prompt input is invalid.");
  }
  const prompt = promptText.trim();
  if (!prompt) throw new Error("Prompt text is empty.");
  if (prompt.length > 20_000) throw new Error("Prompt text is too long.");

  const promptHash = crypto.createHash("sha1").update(prompt).digest("hex").slice(0, 12);
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO feed_resident_prompts (feed_id, prompt, prompt_hash, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(feed_id) DO UPDATE SET
      prompt = excluded.prompt,
      prompt_hash = excluded.prompt_hash,
      updated_at = excluded.updated_at
  `).run(feedId, prompt, promptHash, now);
  archiveResidentPromptVersions(feedId);
}

export function clearFeedResidentPrompt(feedId: string): void {
  getDatabase().prepare("DELETE FROM feed_resident_prompts WHERE feed_id = ?").run(feedId);
  archiveResidentPromptVersions(feedId);
}

function archiveResidentPromptVersions(feedId: string): void {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE resident_prompt_versions SET status = 'rejected', reviewed_at = ? WHERE feed_id = ? AND status IN ('active', 'pending')"
  ).run(now, feedId);
  db.prepare(`
    INSERT INTO resident_prompt_cycles (feed_id, started_at) VALUES (?, ?)
    ON CONFLICT(feed_id) DO UPDATE SET started_at = excluded.started_at
  `).run(feedId, now);
}

export function ensureFeedResidents(feedId: string): FeedResident[] {
  const db = getDatabase();
  const definitions = [
    ["veteran", "技術的な根拠を確認し、記事から断言できないことを切り分ける経験者"],
    ["builder", "実装・運用・保守への現実的な影響を話す現場派"],
    ["curious", "素朴な質問や軽い勘違いで会話を動かす聞き役"]
  ] as const;
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO feed_residents (id, feed_id, resident_key, stable_uid, traits, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const [key, traits] of definitions) {
    const stableUid = crypto
      .createHash("sha256")
      .update(`viper-resident:${feedId}:${key}`)
      .digest("hex")
      .slice(0, 8);
    insert.run(`resident:${feedId}:${key}`, feedId, key, stableUid, traits, now);
  }
  return db.prepare(
    "SELECT id, resident_key, stable_uid, traits FROM feed_residents WHERE feed_id = ? ORDER BY resident_key"
  ).all(feedId).map((row: any) => ({
    id: row.id,
    key: row.resident_key,
    stableUid: row.stable_uid,
    traits: row.traits
  }));
}

export function getActiveResidentPromptVersion(feedId: string): ResidentPromptVersion | null {
  const row = getDatabase().prepare(`
    SELECT id, feed_id, parent_id, adaptive_prompt, rationale, changes_json, status, model, created_at, reviewed_at
    FROM resident_prompt_versions WHERE feed_id = ? AND status = 'active' ORDER BY reviewed_at DESC LIMIT 1
  `).get(feedId) as any;
  return row ? mapPromptVersion(row) : null;
}

export function listResidentPromptVersions(feedId: string): ResidentPromptVersion[] {
  return (getDatabase().prepare(`
    SELECT id, feed_id, parent_id, adaptive_prompt, rationale, changes_json, status, model, created_at, reviewed_at
    FROM resident_prompt_versions WHERE feed_id = ? ORDER BY created_at DESC
  `).all(feedId) as any[]).map(mapPromptVersion);
}

function mapPromptVersion(row: any): ResidentPromptVersion {
  return {
    id: row.id,
    feedId: row.feed_id,
    parentId: row.parent_id,
    adaptivePrompt: row.adaptive_prompt,
    rationale: row.rationale,
    changes: JSON.parse(row.changes_json || "[]"),
    status: row.status,
    model: row.model,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at
  };
}

export function saveResidentPromptProposal(params: {
  id: string;
  feedId: string;
  parentId: string | null;
  basePromptHash: string;
  adaptivePrompt: string;
  rationale: string;
  changes: string[];
  model: string;
  feedbackThroughAt: string;
}): void {
  const now = new Date().toISOString();
  getDatabase().prepare(`
    INSERT INTO resident_prompt_versions
    (id, feed_id, parent_id, base_prompt_hash, adaptive_prompt, rationale, changes_json, status, model, feedback_through_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    params.id,
    params.feedId,
    params.parentId,
    params.basePromptHash,
    params.adaptivePrompt,
    params.rationale,
    JSON.stringify(params.changes),
    params.model,
    params.feedbackThroughAt,
    now
  );
}

export function reviewResidentPromptVersion(
  id: string,
  decision: "active" | "rejected"
): void {
  const db = getDatabase();
  const row = db
    .prepare("SELECT feed_id FROM resident_prompt_versions WHERE id = ? AND status = 'pending'")
    .get(id) as { feed_id: string } | undefined;
  if (!row) throw new Error("確認待ちの改善案が見つかりません。");

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    if (decision === "active") {
      db.prepare(
        "UPDATE resident_prompt_versions SET status = 'archived', reviewed_at = ? WHERE feed_id = ? AND status = 'active'"
      ).run(now, row.feed_id);
    }
    db.prepare(
      "UPDATE resident_prompt_versions SET status = ?, reviewed_at = ? WHERE id = ?"
    ).run(decision, now, id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function rollbackResidentPromptVersion(feedId: string): void {
  const db = getDatabase();
  const previous = db.prepare(
    "SELECT id FROM resident_prompt_versions WHERE feed_id = ? AND status = 'archived' ORDER BY reviewed_at DESC LIMIT 1"
  ).get(feedId) as { id: string } | undefined;
  if (!previous) throw new Error("戻せる改善版がありません。");

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(
      "UPDATE resident_prompt_versions SET status = 'archived', reviewed_at = ? WHERE feed_id = ? AND status = 'active'"
    ).run(now, feedId);
    db.prepare(
      "UPDATE resident_prompt_versions SET status = 'active', reviewed_at = ? WHERE id = ?"
    ).run(now, previous.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

const allowedFeedbackTags = new Set(["off_topic", "repetitive", "shallow", "weak_vip", "verbose"]);

export function saveReplyFeedback(runId: string, rating: ReplyRating, tags: string[]): string {
  if (rating !== "good" && rating !== "poor") throw new Error("評価が不正です。");
  if (typeof runId !== "string" || !runId || runId.length > 512 || !Array.isArray(tags)) {
    throw new Error("評価内容が不正です。");
  }
  const cleanTags = tags.filter((tag) => allowedFeedbackTags.has(tag));
  const db = getDatabase();
  const run = db.prepare(
    "SELECT feed_id FROM reply_generation_runs WHERE id = ?"
  ).get(runId) as { feed_id: string } | undefined;
  if (!run) throw new Error("評価対象のレスが見つかりません。");

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO reply_feedback (run_id, rating, tags_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET rating = excluded.rating, tags_json = excluded.tags_json, updated_at = excluded.updated_at
  `).run(runId, rating, JSON.stringify(cleanTags), now, now);
  return run.feed_id;
}

export function getPromptOptimizationEvidence(feedId: string): {
  ratedCount: number;
  latestRatingAt: string | null;
  hasPending: boolean;
  implicitContinues: number;
  samples: Array<{ rating: string; tags: string[]; posts: string }>;
} {
  const db = getDatabase();
  const lastProposal = db.prepare(
    "SELECT feedback_through_at FROM resident_prompt_versions WHERE feed_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(feedId) as { feedback_through_at: string } | undefined;
  const cycle = db.prepare(
    "SELECT started_at FROM resident_prompt_cycles WHERE feed_id = ?"
  ).get(feedId) as { started_at: string } | undefined;
  const since = [lastProposal?.feedback_through_at ?? "", cycle?.started_at ?? ""].sort().at(-1) as string;
  const rows = db.prepare(`
    SELECT f.rating, f.tags_json, f.created_at, r.feed_item_id, r.start_no, r.end_no
    FROM reply_feedback f JOIN reply_generation_runs r ON r.id = f.run_id
    WHERE r.feed_id = ? AND f.created_at > ? ORDER BY f.created_at ASC
  `).all(feedId, since) as any[];
  const samples = rows.slice(-10).map((row) => {
    const posts = db.prepare(
      "SELECT no, body FROM thread_posts WHERE feed_item_id = ? AND no BETWEEN ? AND ? ORDER BY no"
    ).all(row.feed_item_id, row.start_no, row.end_no) as Array<{ no: number; body: string }>;
    return {
      rating: row.rating,
      tags: JSON.parse(row.tags_json || "[]"),
      posts: posts.map((post) => `${post.no}: ${post.body}`).join("\n").slice(0, 3000)
    };
  });
  const pending = db.prepare(
    "SELECT 1 FROM resident_prompt_versions WHERE feed_id = ? AND status = 'pending'"
  ).get(feedId);
  const implicit = db.prepare(`
    SELECT COUNT(*) AS count FROM reply_generation_runs
    WHERE feed_id = ? AND created_at > ? AND (user_continued_at IS NOT NULL OR continued_thread_at IS NOT NULL)
  `).get(feedId, since) as { count: number };

  return {
    ratedCount: rows.length,
    latestRatingAt: rows.at(-1)?.created_at ?? null,
    hasPending: Boolean(pending),
    implicitContinues: Number(implicit.count),
    samples
  };
}
