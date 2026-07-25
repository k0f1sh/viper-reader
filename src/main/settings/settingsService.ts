import * as electron from "electron";
import { getDatabase } from "../db/database.js";
import type { GeminiApiKeyStatus } from "../../shared/types.js";

const activeModelSettingKey = "replyModel";
const defaultActiveModel = "gemini-3.6-flash";
const titleModelSettingKey = "titleModel";
const defaultTitleModel = "gemini-3.5-flash-lite";
const optimizerModelSettingKey = "optimizerModel";
const defaultOptimizerModel = "gemini-3.6-flash";
const geminiApiKeySettingKey = "geminiApiKey";
const encryptedSettingPrefix = "safe-storage:v1:";
const plainTextSettingPrefix = "plain-text:v1:";
const rendererSettingKeys = new Set([
  "replyModel",
  "titleModel",
  "optimizerModel",
  "threadColumnWidths",
  "threadColumnWidthsV2",
  "threadListHeight",
  "threadTabs",
  "feedPaneWidth",
  "articlePaneWidth",
  "articlePaneVisible",
  "articleBrowserBlockingEnabled"
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
  const storedValue = getUserSetting(geminiApiKeySettingKey)?.trim();
  if (storedValue) {
    return readStoredGeminiApiKey(storedValue);
  }

  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || null;
}

export function getGeminiApiKeyStatus(): GeminiApiKeyStatus {
  const storedValue = getUserSetting(geminiApiKeySettingKey)?.trim();
  if (storedValue) {
    readStoredGeminiApiKey(storedValue);
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

  saveUserSetting(geminiApiKeySettingKey, encodeGeminiApiKeyForStorage(normalizedKey));
  return { configured: true, source: "settings" };
}

export function clearGeminiApiKey(): GeminiApiKeyStatus {
  deleteUserSetting(geminiApiKeySettingKey);
  return getGeminiApiKeyStatus();
}

export function getActiveModel(): string {
  return getUserSetting(activeModelSettingKey) || defaultActiveModel;
}

export function getTitleGenerationModel(): string {
  return getUserSetting(titleModelSettingKey) || defaultTitleModel;
}

export function getPromptOptimizerModel(): string {
  return getUserSetting(optimizerModelSettingKey) || defaultOptimizerModel;
}

function readStoredGeminiApiKey(storedValue: string): string {
  if (storedValue.startsWith(plainTextSettingPrefix)) {
    return storedValue.slice(plainTextSettingPrefix.length);
  }

  if (!storedValue.startsWith(encryptedSettingPrefix)) {
    saveUserSetting(geminiApiKeySettingKey, encodeGeminiApiKeyForStorage(storedValue));
    return storedValue;
  }

  const encodedValue = storedValue.slice(encryptedSettingPrefix.length);
  try {
    return electron.safeStorage.decryptString(Buffer.from(encodedValue, "base64"));
  } catch {
    throw new Error(
      "保存済みの Gemini API キーを復号できません。保存済みキーを削除して、もう一度登録してください。"
    );
  }
}

function encodeGeminiApiKeyForStorage(apiKey: string): string {
  if (process.platform === "linux") {
    return `${plainTextSettingPrefix}${apiKey}`;
  }

  if (!electron.safeStorage.isEncryptionAvailable()) {
    throw new Error(
      "この環境では OS の安全な資格情報ストアを利用できないため、Gemini API キーを保存できません。"
    );
  }

  const encrypted = electron.safeStorage.encryptString(apiKey);
  return `${encryptedSettingPrefix}${encrypted.toString("base64")}`;
}

function assertRendererSettingKey(key: string): void {
  if (!rendererSettingKeys.has(key)) {
    throw new Error(`Unsupported renderer setting: ${key}`);
  }
}
