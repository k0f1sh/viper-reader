import type { CommandHookConfig, CommandHookProcessState } from "../../shared/types.js";
import { getDatabase } from "../db/database.js";
import { assertIdentifier } from "../ipc/inputValidation.js";
import { getUserSetting, saveUserSetting, deleteUserSetting } from "../settings/settingsService.js";
import { assertCommandHookConfig, CommandHookRunner } from "./commandHookRunner.js";

const settingKey = "commandHook";
const runner = new CommandHookRunner();

export function getCommandHook(): CommandHookConfig | null {
  const stored = getUserSetting(settingKey);
  if (stored === null) return null;
  const config: unknown = JSON.parse(stored);
  assertCommandHookConfig(config);
  return config;
}

export function saveCommandHook(config: unknown): void {
  assertCommandHookConfig(config);
  saveUserSetting(settingKey, JSON.stringify({ command: config.command, args: config.args }));
}

export function clearCommandHook(): void {
  deleteUserSetting(settingKey);
}

export async function runCommandHook(threadId: unknown, onOutput?: (output: string) => void, onProcess?: (state: CommandHookProcessState) => void): Promise<void> {
  assertIdentifier(threadId, "thread ID");
  const config = getCommandHook();
  if (!config) throw new Error("外部フックを設定してください。");
  const thread = getDatabase().prepare(`
    SELECT CASE WHEN fs.kind = 'local' THEN fi.source_url ELSE fi.url END AS url
    FROM feed_items fi JOIN feed_sources fs ON fs.id = fi.feed_id
    WHERE fi.id = ?
  `).get(threadId) as { url: string | null } | undefined;
  if (!thread?.url) throw new Error("元記事URLがありません。");
  await runner.run(config, thread.url, onOutput, onProcess);
}

export function stopCommandHook(): void {
  runner.stop();
}
