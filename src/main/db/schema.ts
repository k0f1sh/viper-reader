export const schemaSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_sources (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS feed_items (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  guid TEXT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TEXT,
  raw_summary TEXT,
  read_at TEXT,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (feed_id) REFERENCES feed_sources(id) ON DELETE CASCADE,
  UNIQUE (feed_id, url)
);

CREATE TABLE IF NOT EXISTS vip_titles (
  id TEXT PRIMARY KEY,
  feed_item_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  FOREIGN KEY (feed_item_id) REFERENCES feed_items(id) ON DELETE CASCADE,
  UNIQUE (feed_item_id, model, prompt_hash)
);

CREATE TABLE IF NOT EXISTS article_bodies (
  id TEXT PRIMARY KEY,
  feed_item_id TEXT NOT NULL,
  url TEXT NOT NULL,
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  summary_text TEXT,
  FOREIGN KEY (feed_item_id) REFERENCES feed_items(id) ON DELETE CASCADE,
  UNIQUE (feed_item_id, content_hash)
);

CREATE TABLE IF NOT EXISTS thread_summaries (
  id TEXT PRIMARY KEY,
  feed_item_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  posts_json TEXT NOT NULL,
  response_count INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL,
  FOREIGN KEY (feed_item_id) REFERENCES feed_items(id) ON DELETE CASCADE,
  UNIQUE (feed_item_id, model, prompt_hash)
);

CREATE TABLE IF NOT EXISTS thread_deep_dives (
  id TEXT PRIMARY KEY,
  feed_item_id TEXT NOT NULL,
  article_body_id TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  posts_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  FOREIGN KEY (feed_item_id) REFERENCES feed_items(id) ON DELETE CASCADE,
  FOREIGN KEY (article_body_id) REFERENCES article_bodies(id) ON DELETE CASCADE,
  UNIQUE (feed_item_id, article_body_id, model, prompt_hash)
);

CREATE TABLE IF NOT EXISTS rss_refresh_runs (
  id TEXT PRIMARY KEY,
  feed_id TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  status TEXT NOT NULL,
  fetched_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  converted_count INTEGER NOT NULL DEFAULT 0,
  conversion_failed_count INTEGER NOT NULL DEFAULT 0,
  conversion_skipped_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  FOREIGN KEY (feed_id) REFERENCES feed_sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS llm_request_logs (
  id TEXT PRIMARY KEY,
  feed_id TEXT,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  item_count INTEGER NOT NULL DEFAULT 0,
  prompt_chars INTEGER NOT NULL DEFAULT 0,
  response_chars INTEGER NOT NULL DEFAULT 0,
  prompt_token_count INTEGER,
  candidates_token_count INTEGER,
  total_token_count INTEGER,
  error_message TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  FOREIGN KEY (feed_id) REFERENCES feed_sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS feed_resident_prompts (
  feed_id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  prompt_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (feed_id) REFERENCES feed_sources(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS article_fetch_logs (
  id TEXT PRIMARY KEY,
  feed_item_id TEXT,
  url TEXT NOT NULL,
  status TEXT NOT NULL,
  robots_result TEXT NOT NULL,
  elapsed_ms INTEGER NOT NULL,
  content_size INTEGER NOT NULL,
  error_message TEXT,
  fetched_at TEXT NOT NULL,
  FOREIGN KEY (feed_item_id) REFERENCES feed_items(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS thread_posts (
  id TEXT PRIMARY KEY,
  feed_item_id TEXT NOT NULL,
  no INTEGER NOT NULL,
  name TEXT NOT NULL,
  mail TEXT,
  date TEXT NOT NULL,
  uid TEXT NOT NULL,
  body TEXT NOT NULL,
  is_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (feed_item_id) REFERENCES feed_items(id) ON DELETE CASCADE,
  UNIQUE (feed_item_id, no)
);

CREATE INDEX IF NOT EXISTS idx_feed_items_feed_id ON feed_items(feed_id);
CREATE INDEX IF NOT EXISTS idx_vip_titles_feed_item_id ON vip_titles(feed_item_id);
CREATE INDEX IF NOT EXISTS idx_thread_summaries_feed_item_id ON thread_summaries(feed_item_id);
CREATE INDEX IF NOT EXISTS idx_rss_refresh_runs_feed_id ON rss_refresh_runs(feed_id);
CREATE INDEX IF NOT EXISTS idx_llm_request_logs_feed_id ON llm_request_logs(feed_id);
CREATE INDEX IF NOT EXISTS idx_feed_resident_prompts_prompt_hash ON feed_resident_prompts(prompt_hash);
CREATE INDEX IF NOT EXISTS idx_article_fetch_logs_feed_item_id ON article_fetch_logs(feed_item_id);
CREATE INDEX IF NOT EXISTS idx_thread_posts_feed_item_id ON thread_posts(feed_item_id);
`;
