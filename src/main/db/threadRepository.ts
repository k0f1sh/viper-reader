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
import { extractRssImages } from "../rss/extractRssImages.js";
import {
  createFirstPostBody,
  createInitialPosts,
  rawTitlePromptHash,
  rssSummaryPromptHash
} from "../threads/initialThreadPosts.js";
import { getDatabase } from "./database.js";
import { saveGeneratedThreadPosts } from "./threadPostRepository.js";
import { countAllUnreadArticles, markThreadRead } from "./threadStateRepository.js";

const unreadSql = "fi.read_at IS NULL";
const hasUnconfirmedRepliesSql = `(
  COALESCE((SELECT MAX(no) FROM thread_posts WHERE feed_item_id = fi.id), 0) > COALESCE(fi.last_read_post_no, 0)
)`;
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
  const countRow = db.prepare(`
    SELECT COUNT(*) AS total_count
    FROM feed_items fi
    WHERE (? IS NULL OR fi.feed_id = ?)
      AND (? = 0 OR ${unreadSql})
  `).get(feedId, feedId, filterUnread) as { total_count: number };
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
      WHERE (? IS NULL OR fi.feed_id = ?)
        AND (? = 0 OR ${unreadSql})
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
      feedId,
      filterUnread,
      safePageSize,
      safePage * safePageSize
    ) as ThreadRow[];

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
  const generationCondition =
    generationQueueMode === "unreviewed"
      ? `AND (
          (fi.generation_status = 'completed' AND fi.generation_reviewed_at IS NULL)
          OR ${hasUnconfirmedRepliesSql}
        )`
      : generationQueueMode === "reviewed"
        ? "AND fi.generation_status = 'completed' AND fi.generation_reviewed_at IS NOT NULL"
        : "";
  const countRow = db.prepare(`
    SELECT COUNT(DISTINCT ${canonicalKey}) AS total_count
    FROM feed_items fi
    WHERE (? = 0 OR ${unreadSql})
      ${generationCondition}
  `).get(filterUnread) as { total_count: number };
  const rows = db.prepare(`
    WITH ranked_items AS (
      SELECT
        fi.*,
        ${canonicalKey} AS article_key,
        ROW_NUMBER() OVER (
          PARTITION BY ${canonicalKey}
          ORDER BY
            CASE WHEN ${unreadSql} THEN 0 ELSE 1 END,
            COALESCE(fi.published_at, fi.created_at) DESC,
            fi.created_at DESC,
            fi.id DESC
        ) AS article_rank
      FROM feed_items fi
      WHERE (? = 0 OR ${unreadSql})
        ${generationCondition}
    ),
    source_names AS (
      SELECT article_key, GROUP_CONCAT(title, ' / ') AS source
      FROM (
        SELECT DISTINCT
          COALESCE(NULLIF(fi.canonical_url, ''), fi.url) AS article_key,
          fs.title AS title
        FROM feed_items fi
        INNER JOIN feed_sources fs ON fs.id = fi.feed_id
        ORDER BY fs.title
      )
      GROUP BY article_key
    )
    SELECT
      fi.id,
      fi.feed_id,
      fi.title AS original_title,
      fi.url,
      CASE WHEN fs.skip_title_conversion = 1 THEN fi.title ELSE COALESCE(generated_vt.title, raw_vt.title, fi.title) END AS thread_title,
      source_names.source,
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
    FROM ranked_items fi
    INNER JOIN feed_sources fs ON fs.id = fi.feed_id
    INNER JOIN source_names ON source_names.article_key = fi.article_key
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
    WHERE fi.article_rank = 1
    ORDER BY
      ${generationQueueMode === "unreviewed" ? "fi.generation_completed_at ASC," : ""}
      ${generationQueueMode === "reviewed" ? "fi.generation_reviewed_at DESC," : ""}
      CASE WHEN ${unreadSql} THEN 0 ELSE 1 END,
      COALESCE(fi.published_at, fi.created_at) DESC,
      fi.created_at DESC,
      fi.id DESC
    LIMIT ? OFFSET ?
  `).all(
    filterUnread,
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
    pageSize,
    page * pageSize
  ) as ThreadRow[];

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
  const rows = db.prepare(`
    SELECT generation_status AS status, COUNT(*) AS count
    FROM feed_items
    WHERE generation_status IN ('queued', 'generating', 'completed')
      AND (generation_status != 'completed' OR generation_reviewed_at IS NULL)
    GROUP BY generation_status
  `).all() as Array<{ status: string; count: number }>;
  const counts = new Map(rows.map((row) => [row.status, Number(row.count)]));
  const completedRow = db.prepare(`
    SELECT COUNT(DISTINCT COALESCE(NULLIF(fi.canonical_url, ''), fi.url)) AS count
    FROM feed_items fi
    WHERE (fi.generation_status = 'completed' AND fi.generation_reviewed_at IS NULL)
      OR ${hasUnconfirmedRepliesSql}
  `).get() as { count: number };
  const reviewedRow = db.prepare(`
    SELECT COUNT(*) AS count
    FROM feed_items
    WHERE generation_status = 'completed' AND generation_reviewed_at IS NOT NULL
  `).get() as { count: number };
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
  const postsRows = db
    .prepare("SELECT no, name, mail, date, uid, body, is_user FROM thread_posts WHERE feed_item_id = ? ORDER BY no ASC")
    .all(threadId) as ThreadPostRow[];

  // 基本的なスレッド情報（threadTitle など）を取得するクエリ
  const threadInfoRow = db
    .prepare(`
      WITH source_names AS (
        SELECT article_key, GROUP_CONCAT(title, ' / ') AS source
        FROM (
          SELECT DISTINCT
            COALESCE(NULLIF(item.canonical_url, ''), item.url) AS article_key,
            source.title AS title
          FROM feed_items item
          INNER JOIN feed_sources source ON source.id = item.feed_id
          ORDER BY source.title
        )
        GROUP BY article_key
      )
      SELECT
        fi.id,
        fi.feed_id,
        fi.title AS original_title,
        fi.url,
        CASE WHEN fs.skip_title_conversion = 1 THEN fi.title ELSE COALESCE(generated_vt.title, raw_vt.title, fi.title) END AS thread_title,
        source_names.source,
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
      INNER JOIN source_names
        ON source_names.article_key = COALESCE(NULLIF(fi.canonical_url, ''), fi.url)
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
    ) as {
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
  const rssImages = extractRssImages(threadInfoRow.raw_summary, threadInfoRow.url);

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
      readMarkerNo,
      rssImages
    };
  }

  // 2. thread_posts にデータがない場合は、古い thread_summaries または RSS から復元（移行）する
  const legacyRow = db
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
    ) as { posts_json?: string; response_posts_json?: string } | undefined;

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
    readMarkerNo,
    rssImages
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
