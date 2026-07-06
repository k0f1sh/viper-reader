#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const command = process.argv[2];
const feedId = process.argv[3];

main();

function main() {
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  const dbPath = resolveDatabasePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON;");
  ensureSchema(db);

  if (command === "list") {
    listFeeds(db);
    return;
  }

  if (!feedId) {
    fail("feed_id is required.");
  }

  if (command === "get") {
    getPrompt(db, feedId);
    return;
  }

  if (command === "set") {
    setPrompt(db, feedId, readPromptText());
    return;
  }

  if (command === "clear") {
    clearPrompt(db, feedId);
    return;
  }

  fail(`Unknown command: ${command}`);
}

function printHelp() {
  console.log(`Usage:
  npm run resident-prompt -- list
  npm run resident-prompt -- get <feed_id>
  npm run resident-prompt -- set <feed_id> "住民プロンプト"
  npm run resident-prompt -- set <feed_id> --file ./prompt.txt
  cat prompt.txt | npm run resident-prompt -- set <feed_id> -
  npm run resident-prompt -- clear <feed_id>

Env:
  VIPER_READER_DB_PATH  Override SQLite database path.
`);
}

function listFeeds(db) {
  if (!tableExists(db, "feed_sources")) {
    console.log("No feeds found. Start ViperReader once to initialize feeds.");
    return;
  }

  const rows = db
    .prepare(
      `
      SELECT
        fs.id,
        fs.title,
        fs.url,
        frp.prompt_hash,
        frp.updated_at
      FROM feed_sources fs
      LEFT JOIN feed_resident_prompts frp ON frp.feed_id = fs.id
      ORDER BY fs.created_at ASC
      `
    )
    .all();

  if (rows.length === 0) {
    console.log("No feeds found. Start ViperReader once to initialize feeds.");
    return;
  }

  for (const row of rows) {
    const status = row.prompt_hash ? `prompt=${row.prompt_hash} updated=${row.updated_at}` : "prompt=(default)";
    console.log(`${row.id}\t${row.title}\t${status}\n  ${row.url}`);
  }
}

function getPrompt(db, targetFeedId) {
  assertFeedExists(db, targetFeedId);
  const row = db
    .prepare(
      `
      SELECT prompt, prompt_hash, updated_at
      FROM feed_resident_prompts
      WHERE feed_id = ?
      `
    )
    .get(targetFeedId);

  if (!row) {
    console.log(`feed_id=${targetFeedId} uses default resident prompt.`);
    return;
  }

  console.log(`# feed_id=${targetFeedId}`);
  console.log(`# prompt_hash=${row.prompt_hash}`);
  console.log(`# updated_at=${row.updated_at}`);
  console.log(row.prompt);
}

function setPrompt(db, targetFeedId, promptText) {
  assertFeedExists(db, targetFeedId);
  const prompt = promptText.trim();
  if (!prompt) {
    fail("Prompt text is empty.");
  }

  const promptHash = crypto.createHash("sha1").update(prompt).digest("hex").slice(0, 12);
  const now = new Date().toISOString();
  db.prepare(
    `
    INSERT INTO feed_resident_prompts (feed_id, prompt, prompt_hash, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(feed_id) DO UPDATE SET
      prompt = excluded.prompt,
      prompt_hash = excluded.prompt_hash,
      updated_at = excluded.updated_at
    `
  ).run(targetFeedId, prompt, promptHash, now);

  console.log(`Saved resident prompt for feed_id=${targetFeedId} prompt_hash=${promptHash}`);
}

function clearPrompt(db, targetFeedId) {
  assertFeedExists(db, targetFeedId);
  const result = db.prepare("DELETE FROM feed_resident_prompts WHERE feed_id = ?").run(targetFeedId);
  console.log(`Cleared resident prompt for feed_id=${targetFeedId} changes=${result.changes}`);
}

function readPromptText() {
  const firstArg = process.argv[4];
  if (firstArg === "--file") {
    const filePath = process.argv[5];
    if (!filePath) {
      fail("--file requires a path.");
    }

    return fs.readFileSync(filePath, "utf8");
  }

  if (firstArg === "-") {
    return fs.readFileSync(0, "utf8");
  }

  return process.argv.slice(4).join(" ");
}

function assertFeedExists(db, targetFeedId) {
  if (!tableExists(db, "feed_sources")) {
    fail("No feeds found. Start ViperReader once to initialize feeds.");
  }

  const row = db.prepare("SELECT id FROM feed_sources WHERE id = ?").get(targetFeedId);
  if (!row) {
    fail(`Feed not found: ${targetFeedId}. Run "npm run resident-prompt -- list" to see feed ids.`);
  }
}

function tableExists(db, tableName) {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS feed_resident_prompts (
      feed_id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      prompt_hash TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (feed_id) REFERENCES feed_sources(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_feed_resident_prompts_prompt_hash ON feed_resident_prompts(prompt_hash);
  `);
}

function resolveDatabasePath() {
  if (process.env.VIPER_READER_DB_PATH) {
    return path.resolve(process.env.VIPER_READER_DB_PATH);
  }

  const appDirectoryName = "viper-reader";
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", appDirectoryName, "viper-reader.db");
  }

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, appDirectoryName, "viper-reader.db");
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(configHome, appDirectoryName, "viper-reader.db");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
