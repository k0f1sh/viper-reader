import * as electron from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { schemaSql } from "./schema.js";
import { canonicalizeArticleUrl } from "../articles/canonicalUrl.js";

let database: DatabaseSync | null = null;

export function getDatabase(): DatabaseSync {
  if (database) {
    return database;
  }

  const dbPathArg = process.argv.find((arg) => arg.startsWith("--db-path="));
  const customDbPath = dbPathArg ? dbPathArg.substring("--db-path=".length) : null;

  const dbPath = customDbPath
    ? path.resolve(customDbPath)
    : (process.env.VIPER_READER_DB_PATH
      ? path.resolve(process.env.VIPER_READER_DB_PATH)
      : path.join(electron.app.getPath("userData"), "viper-reader.db"));
  database = new DatabaseSync(dbPath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  migrate(database);
  return database;
}

function migrate(db: DatabaseSync): void {
  db.exec(schemaSql);
  migrateLegacyTitleTable(db);
  addColumnIfMissing(db, "feed_items", "read_at", "TEXT");
  const addedLastReadPostNo = addColumnIfMissing(db, "feed_items", "last_read_post_no", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "feed_items", "is_favorite", "INTEGER DEFAULT 0");
  addColumnIfMissing(db, "feed_items", "canonical_url", "TEXT");
  addColumnIfMissing(db, "feed_items", "generation_status", "TEXT");
  addColumnIfMissing(db, "feed_items", "generation_requested_at", "TEXT");
  addColumnIfMissing(db, "feed_items", "generation_completed_at", "TEXT");
  addColumnIfMissing(db, "feed_items", "generation_reviewed_at", "TEXT");
  addColumnIfMissing(db, "article_bodies", "summary_text", "TEXT");
  addColumnIfMissing(db, "llm_request_logs", "cached_content_token_count", "INTEGER");
  addColumnIfMissing(db, "thread_posts", "resident_id", "TEXT");
  addColumnIfMissing(db, "feed_sources", "generate_title_from_summary", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "feed_sources", "skip_title_conversion", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "feed_sources", "default_to_article_browser", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(db, "feed_sources", "parent_folder_id", "TEXT REFERENCES feed_folders(id) ON DELETE RESTRICT");
  addColumnIfMissing(db, "feed_sources", "sort_order", "INTEGER");
  backfillFeedSortOrder(db);
  backfillCanonicalUrls(db);
  if (addedLastReadPostNo) backfillLastReadPostNo(db);
  db.exec("CREATE INDEX IF NOT EXISTS idx_feed_items_canonical_url ON feed_items(canonical_url)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_feed_items_article_key ON feed_items(COALESCE(NULLIF(canonical_url, ''), url))");
  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)"
  ).run(1, new Date().toISOString());
  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)"
  ).run(2, new Date().toISOString());
}

function migrateLegacyTitleTable(db: DatabaseSync): void {
  const legacyTableName = ["vi", "p_titles"].join("");
  const legacyTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(legacyTableName);
  if (!legacyTable) return;

  db.exec("BEGIN");
  try {
    db.exec(`
      INSERT OR IGNORE INTO thread_titles (id, feed_item_id, model, prompt_hash, title, generated_at)
      SELECT id, feed_item_id, model, prompt_hash, title, generated_at FROM ${legacyTableName};
      DROP TABLE ${legacyTableName};
    `);
    db.prepare(
      "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)"
    ).run(3, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function backfillFeedSortOrder(db: DatabaseSync): void {
  const rows = db.prepare(
    "SELECT id FROM feed_sources WHERE sort_order IS NULL ORDER BY created_at ASC, id ASC"
  ).all() as Array<{ id: string }>;
  if (rows.length === 0) return;

  const currentMax = db.prepare(
    "SELECT COALESCE(MAX(sort_order), -1) AS max_sort_order FROM feed_sources"
  ).get() as { max_sort_order: number };
  const update = db.prepare("UPDATE feed_sources SET sort_order = ? WHERE id = ?");
  let nextSortOrder = Number(currentMax.max_sort_order) + 1;
  for (const row of rows) {
    update.run(nextSortOrder, row.id);
    nextSortOrder += 1;
  }
}

function backfillCanonicalUrls(db: DatabaseSync): void {
  const rows = db.prepare("SELECT id, url FROM feed_items WHERE canonical_url IS NULL OR canonical_url = ''").all() as Array<{ id: string; url: string }>;
  if (rows.length === 0) return;
  const update = db.prepare("UPDATE feed_items SET canonical_url = ? WHERE id = ?");
  db.exec("BEGIN");
  try {
    for (const row of rows) update.run(canonicalizeArticleUrl(row.url), row.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function backfillLastReadPostNo(db: DatabaseSync): void {
  db.exec(`
    UPDATE feed_items
    SET last_read_post_no = COALESCE(
      (SELECT MAX(no) FROM thread_posts WHERE feed_item_id = feed_items.id),
      0
    )
    WHERE read_at IS NOT NULL
  `);
}

function addColumnIfMissing(db: DatabaseSync, tableName: string, columnName: string, columnType: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return false;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  return true;
}
