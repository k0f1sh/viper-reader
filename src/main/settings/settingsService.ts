import { getDatabase } from "../db/database.js";
import type { GeminiApiKeyStatus } from "../../shared/types.js";

const activeModelSettingKey = "replyModel";
const defaultActiveModel = "gemini-3.1-flash-lite";
const geminiApiKeySettingKey = "geminiApiKey";
const rendererSettingKeys = new Set([
  "replyModel",
  "threadColumnWidths",
  "threadListHeight",
  "threadTabs"
]);

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

export function deleteUserSetting(key: string): void {
  getDatabase().prepare("DELETE FROM user_settings WHERE key = ?").run(key);
}

export function getRendererUserSetting(key: string): string | null {
  assertRendererSettingKey(key);
  return getUserSetting(key);
}

export function saveRendererUserSetting(key: string, value: string): void {
  assertRendererSettingKey(key);
  saveUserSetting(key, value);
}

export function getGeminiApiKey(): string | null {
  const storedKey = getUserSetting(geminiApiKeySettingKey)?.trim();
  if (storedKey) {
    return storedKey;
  }

  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
}

export function getGeminiApiKeyStatus(): GeminiApiKeyStatus {
  if (getUserSetting(geminiApiKeySettingKey)?.trim()) {
    return { configured: true, source: "settings" };
  }

  if (process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim()) {
    return { configured: true, source: "environment" };
  }

  return { configured: false, source: "none" };
}

export function saveGeminiApiKey(apiKey: string): GeminiApiKeyStatus {
  const normalizedKey = apiKey.trim();
  if (!normalizedKey) {
    throw new Error("Gemini API キーを入力してください。");
  }

  saveUserSetting(geminiApiKeySettingKey, normalizedKey);
  return { configured: true, source: "settings" };
}

export function clearGeminiApiKey(): GeminiApiKeyStatus {
  deleteUserSetting(geminiApiKeySettingKey);
  return getGeminiApiKeyStatus();
}

export function getActiveModel(): string {
  return getUserSetting(activeModelSettingKey) || defaultActiveModel;
}

function assertRendererSettingKey(key: string): void {
  if (!rendererSettingKeys.has(key)) {
    throw new Error(`Unsupported renderer setting: ${key}`);
  }
}
