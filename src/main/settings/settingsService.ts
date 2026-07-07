import { getDatabase } from "../db/database.js";

const activeModelSettingKey = "replyModel";
const defaultActiveModel = "gemini-3.1-flash-lite";

export function getUserSetting(key: string): string | null {
  const db = getDatabase();
  const row = db
    .prepare("SELECT value FROM user_settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

export function saveUserSetting(key: string, value: string): void {
  const db = getDatabase();
  const updatedAt = new Date().toISOString();
  db.prepare(
    `
    INSERT OR REPLACE INTO user_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    `
  ).run(key, value, updatedAt);
}

export function getActiveModel(): string {
  return getUserSetting(activeModelSettingKey) || defaultActiveModel;
}
