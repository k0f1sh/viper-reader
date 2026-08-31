import type {
  ReadingQueueSummary,
  ThreadDetail,
  ThreadListItem,
  ThreadListPage,
  ThreadPost
} from "../../shared/types.js";
import {
  defaultResidentPromptHash,
  threadResponsePromptHash
} from "../prompts/threadResponsePrompt.js";
import { buildThreadTitlePromptHash } from "../prompts/threadTitlePrompt.js";
import { getActiveModel, getTitleGenerationModel } from "../settings/settingsService.js";
import {
  createFirstPostBody,
  createInitialPosts,
  rawTitlePromptHash,
  rssSummaryPromptHash
} from "../threads/initialThreadPosts.js";
import { getDatabase } from "./database.js";
import { saveGeneratedThreadPosts } from "./threadPostRepository.js";
import { countAllUnreadArticles, markThreadRead } from "./threadStateRepository.js";
import { runWithSlowQueryLog } from "./slowQueryLogger.js";

const unreadSql = "fi.read_at IS NULL";
const hasUnconfirmedRepliesSql = "fi.latest_post_no > fi.last_read_post_no";
type ThreadRow = {
  id: string;
  feed_id: string;
  original_title: string;
  url: string;
  thread_title: string;
  source: string;
  published_at: string | null;
  read_at: string | null;
  last_read_post_no: number;
  raw_summary: string | null;
  response_count: number;
  is_favorite: number;
  generation_status?: ThreadListItem["generationStatus"];
  title_generation_status?: "completed" | "failed" | "skipped" | null;
  posts_json?: string;
  response_posts_json?: string;
};




export function listThreads(feedId: string | null, page = 0, pageSize = 100, unreadOnly = false): ThreadListPage {
  const db = getDatabase();
  const activeModel = getActiveModel();
  const titleModel = getTitleGenerationModel();
  const summaryTitlePromptHash = buildThreadTitlePromptHash(true);
  const plainTitlePromptHash = buildThreadTitlePromptHash(false);
  const safePage = Math.max(0, Math.floor(page));
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  const filterUnread = unreadOnly ? 1 : 0;
  if (feedId === null) {
    return listAllThreads(db, activeModel, titleModel, safePage, safePageSize, filterUnread);
  }
  const unreadCondition = unreadOnly ? `AND ${unreadSql}` : "";
  const countRow = runWithSlowQueryLog("listThreads.count", () => db.prepare(`
    SELECT COUNT(*) AS total_count
    FROM feed_items fi
    WHERE fi.feed_id = ?
      ${unreadCondition}
  `).get(feedId)) as { total_count: number };
  const rows = runWithSlowQueryLog("listThreads.items", () => db
    .prepare(
      `
      SELECT
        fi.id,
        fi.feed_id,
        fi.title AS original_title,
        fi.url,
        CASE WHEN fs.skip_title_conversion = 1 THEN fi.title ELSE COALESCE(generated_vt.title, raw_vt.title, fi.title) END AS thread_title,
        fs.title AS source,
        fi.published_at,
        fi.read_at,
        fi.last_read_post_no,
        fi.is_favorite,
        fi.generation_status,
        CASE
          WHEN fs.skip_title_conversion = 1 OR generated_vt.id IS NOT NULL THEN NULL
          WHEN (SELECT status FROM title_generation_attempts WHERE feed_item_id = fi.id ORDER BY attempted_at DESC, rowid DESC LIMIT 1) = 'failed' THEN 'failed'
          ELSE 'skipped'
        END AS title_generation_status,
        fi.raw_summary,
        COALESCE((SELECT COUNT(*) FROM thread_posts WHERE feed_item_id = fi.id), COALESCE(rss_ts.response_count, 0) + COALESCE(response_ts.response_count, 0), 1) AS response_count
      FROM feed_items fi
      INNER JOIN feed_sources fs ON fs.id = fi.feed_id
      LEFT JOIN thread_titles generated_vt
        ON generated_vt.feed_item_id = fi.id
        AND generated_vt.model = ?
        AND generated_vt.prompt_hash = CASE
          WHEN fs.generate_title_from_summary = 1 THEN ?
          ELSE ?
        END
      LEFT JOIN thread_titles raw_vt
        ON raw_vt.feed_item_id = fi.id
        AND raw_vt.model = ?
        AND raw_vt.prompt_hash = ?
      LEFT JOIN thread_summaries rss_ts
        ON rss_ts.feed_item_id = fi.id
        AND rss_ts.model = ?
        AND rss_ts.prompt_hash = ?
      LEFT JOIN feed_resident_prompts frp
        ON frp.feed_id = fi.feed_id
      LEFT JOIN thread_summaries response_ts
        ON response_ts.feed_item_id = fi.id
        AND response_ts.model = ?
        AND response_ts.prompt_hash = (? || ':' || COALESCE(frp.prompt_hash, ?))
      WHERE fi.feed_id = ?
        ${unreadCondition}
      ORDER BY
        CASE WHEN ${unreadSql} THEN 0 ELSE 1 END ASC,
        COALESCE(fi.published_at, fi.created_at) DESC,
        fi.created_at DESC,
        fi.id DESC
      LIMIT ? OFFSET ?
      `
    )
    .all(
      titleModel,
      summaryTitlePromptHash,
      plainTitlePromptHash,
      titleModel,
      rawTitlePromptHash,
      activeModel,
      rssSummaryPromptHash,
      activeModel,
      threadResponsePromptHash,
      defaultResidentPromptHash,
      feedId,
      safePageSize,
      safePage * safePageSize
    ) as ThreadRow[]);

  return {
    items: rows.map(rowToThreadListItem),
    totalCount: Number(countRow.total_count),
    page: safePage,
    pageSize: safePageSize
  };
}

function listAllThreads(
  db: ReturnType<typeof getDatabase>,
  activeModel: string,
  titleModel: string,
  page: number,
  pageSize: number,
  filterUnread: number,
  generationQueueMode: "none" | "unreviewed" | "reviewed" = "none"
): ThreadListPage {
  const summaryTitlePromptHash = buildThreadTitlePromptHash(true);
  const plainTitlePromptHash = buildThreadTitlePromptHash(false);
  const canonicalKey = "COALESCE(NULLIF(fi.canonical_url, ''), fi.url)";
  const allUnreadCondition = filterUnread ? `AND ${unreadSql}` : "";
  const candidateUnreadCondition = filterUnread ? "AND candidate.read_at IS NULL" : "";
  const generationCondition =
    generationQueueMode === "unreviewed"
      ? `AND (
          (fi.generation_status = 'completed' AND fi.generation_reviewed_at IS NULL)
          OR ${hasUnconfirmedRepliesSql}
        )`
      : generationQueueMode === "reviewed"
        ? "AND fi.generation_status = 'completed' AND fi.generation_reviewed_at IS NOT NULL"
        : "";
  const pageItemsSql = generationQueueMode === "none"
    ? `page_item_ids AS (
        SELECT fi.id, ${canonicalKey} AS article_key
        FROM feed_items fi
        WHERE 1 = 1
          ${allUnreadCondition}
          AND fi.id = (
            SELECT candidate.id
            FROM feed_items candidate
            WHERE COALESCE(NULLIF(candidate.canonical_url, ''), candidate.url)
              = COALESCE(NULLIF(fi.canonical_url, ''), fi.url)
              ${candidateUnreadCondition}
            ORDER BY
              CASE WHEN candidate.read_at IS NULL THEN 0 ELSE 1 END,
              COALESCE(candidate.published_at, candidate.created_at) DESC,
              candidate.created_at DESC,
              candidate.id DESC
            LIMIT 1
          )
        ORDER BY
          CASE WHEN fi.read_at IS NULL THEN 0 ELSE 1 END,
          COALESCE(fi.published_at, fi.created_at) DESC,
          fi.created_at DESC,
          fi.id DESC
        LIMIT ? OFFSET ?
      ),
      page_items AS (
        SELECT fi.*, page_item_ids.article_key
        FROM page_item_ids
        INNER JOIN feed_items fi ON fi.id = page_item_ids.id
      )`
    : generationQueueMode === "reviewed"
      ? `page_item_ids AS (
        SELECT fi.id, ${canonicalKey} AS article_key
        FROM feed_items fi
        WHERE fi.generation_status = 'completed'
          AND fi.generation_reviewed_at IS NOT NULL
          AND fi.id = (
            SELECT candidate.id
            FROM feed_items candidate
            WHERE COALESCE(NULLIF(candidate.canonical_url, ''), candidate.url)
              = COALESCE(NULLIF(fi.canonical_url, ''), fi.url)
              AND candidate.generation_status = 'completed'
              AND candidate.generation_reviewed_at IS NOT NULL
            ORDER BY
              CASE WHEN candidate.read_at IS NULL THEN 0 ELSE 1 END,
              COALESCE(candidate.published_at, candidate.created_at) DESC,
              candidate.created_at DESC,
              candidate.id DESC
            LIMIT 1
          )
        ORDER BY
          fi.generation_reviewed_at DESC,
          CASE WHEN fi.read_at IS NULL THEN 0 ELSE 1 END,
          COALESCE(fi.published_at, fi.created_at) DESC,
          fi.created_at DESC,
          fi.id DESC
        LIMIT ? OFFSET ?
      ),
      page_items AS (
        SELECT fi.*, page_item_ids.article_key
        FROM page_item_ids
        INNER JOIN feed_items fi ON fi.id = page_item_ids.id
      )`
      : `candidate_items AS (
        SELECT id FROM feed_items
        WHERE generation_status = 'completed' AND generation_reviewed_at IS NULL
        UNION ALL
        SELECT id FROM feed_items
        WHERE latest_post_no > last_read_post_no
      ),
      ranked_items AS (
        SELECT
          fi.id,
          ${canonicalKey} AS article_key,
          fi.generation_completed_at,
          fi.generation_reviewed_at,
          fi.read_at,
          fi.published_at,
          fi.created_at,
          ROW_NUMBER() OVER (
            PARTITION BY ${canonicalKey}
            ORDER BY
              CASE WHEN ${unreadSql} THEN 0 ELSE 1 END,
              COALESCE(fi.published_at, fi.created_at) DESC,
              fi.created_at DESC,
              fi.id DESC
          ) AS article_rank
        FROM candidate_items
        INNER JOIN feed_items fi ON fi.id = candidate_items.id
      ),
      page_item_ids AS (
        SELECT id, article_key
        FROM ranked_items
        WHERE article_rank = 1
        ORDER BY
          generation_completed_at ASC,
          CASE WHEN read_at IS NULL THEN 0 ELSE 1 END,
          COALESCE(published_at, created_at) DESC,
          created_at DESC,
          id DESC
        LIMIT ? OFFSET ?
      ),
      page_items AS (
        SELECT fi.*, page_item_ids.article_key
        FROM page_item_ids
        INNER JOIN feed_items fi ON fi.id = page_item_ids.id
      )`;
  const countSql = generationQueueMode === "unreviewed"
    ? `SELECT COUNT(DISTINCT article_key) AS total_count
       FROM (
         SELECT COALESCE(NULLIF(canonical_url, ''), url) AS article_key
         FROM feed_items
         WHERE generation_status = 'completed' AND generation_reviewed_at IS NULL
         UNION ALL
         SELECT COALESCE(NULLIF(canonical_url, ''), url) AS article_key
         FROM feed_items
         WHERE latest_post_no > last_read_post_no
       )`
    : `SELECT COUNT(DISTINCT ${canonicalKey}) AS total_count
       FROM feed_items fi
       WHERE 1 = 1
         ${allUnreadCondition}
         ${generationCondition}`;
  const countRow = runWithSlowQueryLog(`listAllThreads.${generationQueueMode}.count`, () => {
    const statement = db.prepare(countSql);
    return statement.get();
  }) as { total_count: number };
  const rows = runWithSlowQueryLog(`listAllThreads.${generationQueueMode}.items`, () => db.prepare(`
    WITH ${pageItemsSql}
    SELECT
      fi.id,
      fi.feed_id,
      fi.title AS original_title,
      fi.url,
      CASE WHEN fs.skip_title_conversion = 1 THEN fi.title ELSE COALESCE(generated_vt.title, raw_vt.title, fi.title) END AS thread_title,
      (
        SELECT GROUP_CONCAT(title, ' / ')
        FROM (
          SELECT DISTINCT fs2.title AS title
          FROM feed_items fi2
          INNER JOIN feed_sources fs2 ON fs2.id = fi2.feed_id
          WHERE COALESCE(NULLIF(fi2.canonical_url, ''), fi2.url) = fi.article_key
          ORDER BY fs2.title
        )
      ) AS source,
      fi.published_at,
      fi.read_at,
      fi.last_read_post_no,
      fi.is_favorite,
      fi.generation_status,
      CASE
        WHEN fs.skip_title_conversion = 1 OR generated_vt.id IS NOT NULL THEN NULL
        WHEN (SELECT status FROM title_generation_attempts WHERE feed_item_id = fi.id ORDER BY attempted_at DESC, rowid DESC LIMIT 1) = 'failed' THEN 'failed'
        ELSE 'skipped'
      END AS title_generation_status,
      fi.raw_summary,
      COALESCE((SELECT COUNT(*) FROM thread_posts WHERE feed_item_id = fi.id), COALESCE(rss_ts.response_count, 0) + COALESCE(response_ts.response_count, 0), 1) AS response_count
    FROM page_items fi
    INNER JOIN feed_sources fs ON fs.id = fi.feed_id
    LEFT JOIN thread_titles generated_vt
      ON generated_vt.feed_item_id = fi.id
      AND generated_vt.model = ?
      AND generated_vt.prompt_hash = CASE
        WHEN fs.generate_title_from_summary = 1 THEN ?
        ELSE ?
      END
    LEFT JOIN thread_titles raw_vt
      ON raw_vt.feed_item_id = fi.id AND raw_vt.model = ? AND raw_vt.prompt_hash = ?
    LEFT JOIN thread_summaries rss_ts
      ON rss_ts.feed_item_id = fi.id AND rss_ts.model = ? AND rss_ts.prompt_hash = ?
    LEFT JOIN feed_resident_prompts frp ON frp.feed_id = fi.feed_id
    LEFT JOIN thread_summaries response_ts
      ON response_ts.feed_item_id = fi.id
      AND response_ts.model = ?
      AND response_ts.prompt_hash = (? || ':' || COALESCE(frp.prompt_hash, ?))
    ORDER BY
      ${generationQueueMode === "unreviewed" ? "fi.generation_completed_at ASC," : ""}
      ${generationQueueMode === "reviewed" ? "fi.generation_reviewed_at DESC," : ""}
      CASE WHEN ${unreadSql} THEN 0 ELSE 1 END,
      COALESCE(fi.published_at, fi.created_at) DESC,
      fi.created_at DESC,
      fi.id DESC
  `).all(
    pageSize,
    page * pageSize,
    titleModel,
    summaryTitlePromptHash,
    plainTitlePromptHash,
    titleModel,
    rawTitlePromptHash,
    activeModel,
    rssSummaryPromptHash,
    activeModel,
    threadResponsePromptHash,
    defaultResidentPromptHash
  )) as ThreadRow[];

  return { items: rows.map(rowToThreadListItem), totalCount: Number(countRow.total_count), page, pageSize };
}

export function listGeneratedQueue(page = 0, pageSize = 100, reviewed = false): ThreadListPage {
  const safePage = Math.max(0, Math.floor(page));
  const safePageSize = Math.min(100, Math.max(1, Math.floor(pageSize)));
  return listAllThreads(
    getDatabase(),
    getActiveModel(),
    getTitleGenerationModel(),
    safePage,
    safePageSize,
    0,
    reviewed ? "reviewed" : "unreviewed"
  );
}

export function getReadingQueueSummary(): ReadingQueueSummary {
  const db = getDatabase();
  const unreadCount = countAllUnreadArticles();
  const rows = runWithSlowQueryLog("readingQueueSummary.statuses", () => db.prepare(`
    SELECT generation_status AS status, COUNT(*) AS count
    FROM feed_items
    WHERE generation_status IN ('queued', 'generating', 'completed')
      AND (generation_status != 'completed' OR generation_reviewed_at IS NULL)
    GROUP BY generation_status
  `).all()) as Array<{ status: string; count: number }>;
  const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
  const completedRow = runWithSlowQueryLog("readingQueueSummary.completed", () => db.prepare(`
    SELECT COUNT(DISTINCT article_key) AS count
    FROM (
      SELECT COALESCE(NULLIF(canonical_url, ''), url) AS article_key
      FROM feed_items
      WHERE generation_status = 'completed' AND generation_reviewed_at IS NULL

      UNION ALL

      SELECT COALESCE(NULLIF(canonical_url, ''), url) AS article_key
      FROM feed_items
      WHERE latest_post_no > last_read_post_no
    )
  `).get()) as { count: number };
  const reviewedRow = runWithSlowQueryLog("readingQueueSummary.reviewed", () => db.prepare(`
    SELECT COUNT(*) AS count
    FROM feed_items
    WHERE generation_status = 'completed' AND generation_reviewed_at IS NOT NULL
  `).get()) as { count: number };
  return {
    unreadCount,
    queuedCount: counts.get("queued") ?? 0,
    generatingCount: counts.get("generating") ?? 0,
    completedCount: Number(completedRow.count),
    reviewedCount: Number(reviewedRow.count)
  };
}


type ThreadPostRow = {
  no: number;
  name: string;
  mail: string | null;
  date: string;
  uid: string;
  body: string;
  is_user: number;
};

export function getThread(threadId: string, markAsRead = true): ThreadDetail | null {
  const db = getDatabase();
  const activeModel = getActiveModel();
  const titleModel = getTitleGenerationModel();
  const summaryTitlePromptHash = buildThreadTitlePromptHash(true);
  const plainTitlePromptHash = buildThreadTitlePromptHash(false);
  // 1. thread_posts から取得を試みる
  const postsRows = runWithSlowQueryLog("getThread.posts", () => db
    .prepare("SELECT no, name, mail, date, uid, body, is_user FROM thread_posts WHERE feed_item_id = ? ORDER BY no ASC")
    .all(threadId) as ThreadPostRow[]);

  // 基本的なスレッド情報（threadTitle など）を取得するクエリ
  const threadInfoRow = runWithSlowQueryLog("getThread.info", () => db
    .prepare(`
      SELECT
        fi.id,
        fi.feed_id,
        fi.title AS original_title,
        fi.url,
        CASE WHEN fs.skip_title_conversion = 1 THEN fi.title ELSE COALESCE(generated_vt.title, raw_vt.title, fi.title) END AS thread_title,
        (
          SELECT GROUP_CONCAT(title, ' / ')
          FROM (
            SELECT DISTINCT source.title AS title
            FROM feed_items item
            INNER JOIN feed_sources source ON source.id = item.feed_id
            WHERE COALESCE(NULLIF(item.canonical_url, ''), item.url)
              = COALESCE(NULLIF(fi.canonical_url, ''), fi.url)
            ORDER BY source.title
          )
        ) AS source,
        fi.published_at,
        fi.read_at,
        fi.last_read_post_no,
        fi.is_favorite,
        fi.generation_status,
        CASE
          WHEN fs.skip_title_conversion = 1 OR generated_vt.id IS NOT NULL THEN NULL
          WHEN (SELECT status FROM title_generation_attempts WHERE feed_item_id = fi.id ORDER BY attempted_at DESC, rowid DESC LIMIT 1) = 'failed' THEN 'failed'
          ELSE 'skipped'
        END AS title_generation_status,
        fi.raw_summary
      FROM feed_items fi
      INNER JOIN feed_sources fs ON fs.id = fi.feed_id
      LEFT JOIN thread_titles generated_vt
        ON generated_vt.feed_item_id = fi.id
        AND generated_vt.model = ?
        AND generated_vt.prompt_hash = CASE
          WHEN fs.generate_title_from_summary = 1 THEN ?
          ELSE ?
        END
      LEFT JOIN thread_titles raw_vt
        ON raw_vt.feed_item_id = fi.id
        AND raw_vt.model = ?
        AND raw_vt.prompt_hash = ?
      WHERE fi.id = ?
    `)
    .get(
      titleModel,
      summaryTitlePromptHash,
      plainTitlePromptHash,
      titleModel,
      rawTitlePromptHash,
      threadId
    )) as {
      id: string;
      feed_id: string;
      original_title: string;
      url: string;
      thread_title: string;
      source: string;
      published_at: string | null;
      read_at: string | null;
      last_read_post_no: number;
      is_favorite: number;
      generation_status: ThreadListItem["generationStatus"];
      title_generation_status: "completed" | "failed" | "skipped" | null;
      raw_summary: string | null;
    } | undefined;

  if (!threadInfoRow) {
    return null;
  }

  const listItem = {
    id: threadInfoRow.id,
    feedId: threadInfoRow.feed_id,
    originalTitle: threadInfoRow.original_title,
    url: threadInfoRow.url,
    threadTitle: threadInfoRow.thread_title,
    source: threadInfoRow.source,
    publishedAt: threadInfoRow.published_at ?? "",
    isRead: true,
    isFavorite: threadInfoRow.is_favorite === 1,
    generationStatus: threadInfoRow.generation_status,
    titleGenerationStatus:
      threadInfoRow.title_generation_status === "failed" || threadInfoRow.title_generation_status === "skipped"
        ? threadInfoRow.title_generation_status
        : null,
    responseCount: 0
  };
  if (postsRows.length > 0) {
    const posts: ThreadPost[] = postsRows.map((row) => ({
      no: row.no,
      name: row.name,
      mail: row.mail ?? undefined,
      date: row.date,
      id: row.uid,
      body: row.body,
      isUser: row.is_user === 1
    }));

    const readMarkerNo = getReadMarkerNo(threadInfoRow.read_at, threadInfoRow.last_read_post_no, posts);
    if (markAsRead) markThreadRead(threadId);
    return {
      ...listItem,
      responseCount: posts.length,
      posts,
      readMarkerNo
    };
  }

  // 2. thread_posts にデータがない場合は、古い thread_summaries または RSS から復元（移行）する
  const legacyRow = runWithSlowQueryLog("getThread.legacy", () => db
    .prepare(`
      SELECT
        rss_ts.posts_json,
        response_ts.posts_json AS response_posts_json
      FROM feed_items fi
      LEFT JOIN thread_summaries rss_ts
        ON rss_ts.feed_item_id = fi.id
        AND rss_ts.model = ?
        AND rss_ts.prompt_hash = ?
      LEFT JOIN feed_resident_prompts frp
        ON frp.feed_id = fi.feed_id
      LEFT JOIN thread_summaries response_ts
        ON response_ts.feed_item_id = fi.id
        AND response_ts.model = ?
        AND response_ts.prompt_hash = (? || ':' || COALESCE(frp.prompt_hash, ?))
      WHERE fi.id = ?
    `)
    .get(
      activeModel,
      rssSummaryPromptHash,
      activeModel,
      threadResponsePromptHash,
      defaultResidentPromptHash,
      threadId
    )) as { posts_json?: string; response_posts_json?: string } | undefined;

  const rssPosts = parsePosts(legacyRow?.posts_json);
  const responsePosts = parsePosts(legacyRow?.response_posts_json);

  const initialPosts = normalizeThreadPosts(
    {
      id: threadInfoRow.id,
      feed_id: threadInfoRow.feed_id,
      original_title: threadInfoRow.original_title,
      url: threadInfoRow.url,
      thread_title: threadInfoRow.thread_title,
      source: threadInfoRow.source,
      published_at: threadInfoRow.published_at,
      read_at: threadInfoRow.read_at,
      last_read_post_no: threadInfoRow.last_read_post_no,
      raw_summary: threadInfoRow.raw_summary,
      is_favorite: threadInfoRow.is_favorite,
      generation_status: threadInfoRow.generation_status,
      response_count: 0,
      posts_json: legacyRow?.posts_json ?? undefined,
      response_posts_json: legacyRow?.response_posts_json ?? undefined
    },
    rssPosts,
    responsePosts
  );

  // 移行したデータを thread_posts に保存
  saveGeneratedThreadPosts(threadId, initialPosts);
  const readMarkerNo = getReadMarkerNo(threadInfoRow.read_at, threadInfoRow.last_read_post_no, initialPosts);
  if (markAsRead) markThreadRead(threadId);

  return {
    ...listItem,
    responseCount: initialPosts.length,
    posts: initialPosts,
    readMarkerNo
  };
}

function rowToThreadListItem(row: ThreadRow): ThreadListItem {
  return {
    id: row.id,
    feedId: row.feed_id,
    originalTitle: row.original_title,
    url: row.url,
    threadTitle: row.thread_title,
    source: row.source,
    publishedAt: row.published_at ?? "",
    isRead: row.read_at !== null,
    isFavorite: row.is_favorite === 1,
    responseCount: Number(row.response_count),
    generationStatus: row.generation_status ?? null,
    titleGenerationStatus:
      row.title_generation_status === "failed" || row.title_generation_status === "skipped"
        ? row.title_generation_status
        : null
  };
}

function getReadMarkerNo(readAt: string | null, lastReadPostNo: number, posts: ThreadPost[]): number | null {
  const maxPostNo = posts.reduce((max, post) => Math.max(max, post.no), 0);
  return readAt !== null && lastReadPostNo > 0 && maxPostNo > lastReadPostNo
    ? lastReadPostNo
    : null;
}

function parsePosts(postsJson: string | undefined): ThreadPost[] {
  if (!postsJson) {
    return [];
  }

  try {
    return JSON.parse(postsJson) as ThreadPost[];
  } catch {
    return [];
  }
}

function normalizeThreadPosts(row: ThreadRow, posts: ThreadPost[], responsePosts: ThreadPost[]): ThreadPost[] {
  if (posts.length === 0) {
    return [
      ...createInitialPosts(
        {
          title: row.original_title,
          url: row.url,
          rawSummary: row.raw_summary
        },
        row.published_at ?? new Date().toISOString()
      ),
      ...responsePosts
    ];
  }

  return [
    ...posts.map((post) =>
      post.no === 1
        ? {
            ...post,
            body: createFirstPostBody(row.original_title, row.url, row.raw_summary)
          }
        : post
    ),
    ...responsePosts
  ];
}

export function listFavoriteThreads(): ThreadListItem[] {
  const db = getDatabase();
  const activeModel = getActiveModel();
  const titleModel = getTitleGenerationModel();
  const summaryTitlePromptHash = buildThreadTitlePromptHash(true);
  const plainTitlePromptHash = buildThreadTitlePromptHash(false);
  const rows = db
    .prepare(
      `
      SELECT
        fi.id,
        fi.feed_id,
        fi.title AS original_title,
        fi.url,
        CASE WHEN fs.skip_title_conversion = 1 THEN fi.title ELSE COALESCE(generated_vt.title, raw_vt.title, fi.title) END AS thread_title,
        fs.title AS source,
        fi.published_at,
        fi.read_at,
        fi.is_favorite,
        fi.generation_status,
        CASE
          WHEN fs.skip_title_conversion = 1 OR generated_vt.id IS NOT NULL THEN NULL
          WHEN (SELECT status FROM title_generation_attempts WHERE feed_item_id = fi.id ORDER BY attempted_at DESC, rowid DESC LIMIT 1) = 'failed' THEN 'failed'
          ELSE 'skipped'
        END AS title_generation_status,
        fi.raw_summary,
        COALESCE((SELECT COUNT(*) FROM thread_posts WHERE feed_item_id = fi.id), COALESCE(rss_ts.response_count, 0) + COALESCE(response_ts.response_count, 0), 1) AS response_count
      FROM feed_items fi
      INNER JOIN feed_sources fs ON fs.id = fi.feed_id
      LEFT JOIN thread_titles generated_vt
        ON generated_vt.feed_item_id = fi.id
        AND generated_vt.model = ?
        AND generated_vt.prompt_hash = CASE
          WHEN fs.generate_title_from_summary = 1 THEN ?
          ELSE ?
        END
      LEFT JOIN thread_titles raw_vt
        ON raw_vt.feed_item_id = fi.id
        AND raw_vt.model = ?
        AND raw_vt.prompt_hash = ?
      LEFT JOIN thread_summaries rss_ts
        ON rss_ts.feed_item_id = fi.id
        AND rss_ts.model = ?
        AND rss_ts.prompt_hash = ?
      LEFT JOIN feed_resident_prompts frp
        ON frp.feed_id = fi.feed_id
      LEFT JOIN thread_summaries response_ts
        ON response_ts.feed_item_id = fi.id
        AND response_ts.model = ?
        AND response_ts.prompt_hash = (? || ':' || COALESCE(frp.prompt_hash, ?))
      WHERE fi.is_favorite = 1
      ORDER BY fi.updated_at DESC, COALESCE(fi.published_at, fi.created_at) DESC, fi.created_at DESC, fi.id DESC
      `
    )
    .all(
      titleModel,
      summaryTitlePromptHash,
      plainTitlePromptHash,
      titleModel,
      rawTitlePromptHash,
      activeModel,
      rssSummaryPromptHash,
      activeModel,
      threadResponsePromptHash,
      defaultResidentPromptHash
    ) as ThreadRow[];

  return rows.map(rowToThreadListItem);
}
