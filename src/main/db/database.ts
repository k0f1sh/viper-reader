import { app } from "electron";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { schemaSql } from "./schema.js";

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
      : path.join(app.getPath("userData"), "viper-reader.db"));
  database = new DatabaseSync(dbPath);
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec("PRAGMA journal_mode = WAL;");
  migrate(database);
  return database;
}

function migrate(db: DatabaseSync): void {
  db.exec(schemaSql);
  addColumnIfMissing(db, "feed_items", "read_at", "TEXT");
  addColumnIfMissing(db, "article_bodies", "summary_text", "TEXT");
  db.prepare(
    "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)"
  ).run(1, new Date().toISOString());
}

function addColumnIfMissing(db: DatabaseSync, tableName: string, columnName: string, columnType: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (columns.some((column) => column.name === columnName)) {
    return;
  }

  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
}
