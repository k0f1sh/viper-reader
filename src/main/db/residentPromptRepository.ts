import crypto from "node:crypto";
import type { FeedResidentPrompt } from "../../shared/types.js";
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
}

export function clearFeedResidentPrompt(feedId: string): void {
  getDatabase().prepare("DELETE FROM feed_resident_prompts WHERE feed_id = ?").run(feedId);
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
