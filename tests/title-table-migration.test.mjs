import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after } from "node:test";

const testDirectory = mkdtempSync(path.join(tmpdir(), "viper-reader-title-migration-test-"));
const databasePath = path.join(testDirectory, "test.db");
const legacyTableName = ["vi", "p_titles"].join("");
const setupDb = new DatabaseSync(databasePath);

setupDb.exec(`
  CREATE TABLE feed_sources (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, url TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE feed_items (
    id TEXT PRIMARY KEY, feed_id TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (feed_id, url)
  );
  CREATE TABLE ${legacyTableName} (
    id TEXT PRIMARY KEY, feed_item_id TEXT NOT NULL, model TEXT NOT NULL,
    prompt_hash TEXT NOT NULL, title TEXT NOT NULL, generated_at TEXT NOT NULL,
    UNIQUE (feed_item_id, model, prompt_hash)
  );
  INSERT INTO feed_sources (id, title, url, created_at, updated_at)
  VALUES ('feed', 'Feed', 'https://example.com/feed.xml', '2026-07-31', '2026-07-31');
  INSERT INTO feed_items (id, feed_id, title, url, created_at, updated_at)
  VALUES ('item', 'feed', 'Original', 'https://example.com/item', '2026-07-31', '2026-07-31');
  INSERT INTO ${legacyTableName} (id, feed_item_id, model, prompt_hash, title, generated_at)
  VALUES ('title', 'item', 'model', 'hash', 'Converted', '2026-07-31');
`);
setupDb.close();

process.env.VIPER_READER_DB_PATH = databasePath;
const { getDatabase } = await import("../dist/main/db/database.js");
const db = getDatabase();

after(() => {
  db.close();
  rmSync(testDirectory, { recursive: true, force: true });
});

test("旧タイトルテーブルのデータを汎用名称のテーブルへ移行する", () => {
  assert.deepEqual(
    db.prepare("SELECT id, feed_item_id, title FROM thread_titles").all().map((row) => ({ ...row })),
    [{ id: "title", feed_item_id: "item", title: "Converted" }]
  );
  assert.equal(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(legacyTableName),
    undefined
  );
});
