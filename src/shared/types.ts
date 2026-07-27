export type FeedSource = {
  id: string;
  title: string;
  url: string;
  unreadCount: number;
  lastFetchedAt: string | null;
  generateTitleFromSummary: boolean;
};

export type ThreadPost = {
  no: number;
  name: string;
  mail?: string;
  date: string;
  id: string;
  body: string;
  isUser?: boolean;
};

export type ThreadListItem = {
  id: string;
  feedId: string;
  originalTitle: string;
  url: string;
  vipTitle: string;
  source: string;
  publishedAt: string;
  responseCount: number;
  isRead: boolean;
  isFavorite: boolean;
  generationStatus: "queued" | "generating" | "completed" | "failed" | null;
};

export type ThreadListPage = {
  items: ThreadListItem[];
  totalCount: number;
  page: number;
  pageSize: number;
};

export type ReadingQueueSummary = {
  unreadCount: number;
  queuedCount: number;
  generatingCount: number;
  completedCount: number;
  reviewedCount: number;
  failedCount: number;
};

export type ThreadDetail = ThreadListItem & {
  posts: ThreadPost[];
  replyRuns: ReplyGenerationRun[];
};

export type ArticleBodyContent = {
  threadId: string;
  contentText: string;
};

export type ArticleBrowserBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ArticleBrowserBlockerStatus =
  | "initializing"
  | "active"
  | "disabled-for-site"
  | "disabled-globally"
  | "unavailable";

export type ArticleBrowserState = {
  threadId: string | null;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  blockerStatus: ArticleBrowserBlockerStatus;
  error: string | null;
};

export type ShowArticleBrowserRequest = {
  threadId: string;
  url: string;
  bounds: ArticleBrowserBounds;
  allowUnprotected: boolean;
};

export type ReplyRating = "good" | "poor";

export type ReplyGenerationRun = {
  id: string;
  threadId: string;
  startNo: number;
  endNo: number;
  mode: "reply_to_user" | "continue_thread";
  promptVersionId: string | null;
  rating: ReplyRating | null;
  feedbackTags: string[];
};

export type ResidentPromptVersion = {
  id: string;
  feedId: string;
  parentId: string | null;
  adaptivePrompt: string;
  rationale: string;
  changes: string[];
  status: "pending" | "active" | "rejected" | "archived";
  model: string;
  createdAt: string;
  reviewedAt: string | null;
};

export type RefreshFeedResult = {
  feedId: string;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  convertedCount: number;
  conversionFailedCount: number;
  conversionSkippedCount: number;
  fetchedAt: string;
};

export type RefreshProgress = {
  feedId: string;
  message: string;
};

export type GeminiApiKeyStatus = {
  configured: boolean;
  source: "settings" | "environment" | "none";
};

export type ThreadGenerationStatus = {
  threadId: string;
  status: "done" | "skipped" | "error";
};

export type ThreadGenerationProgress = {
  threadId: string;
  stage: "checking-cache" | "fetching-article" | "preparing-context" | "generating-posts" | "saving-posts";
  message: string;
};

export type AppLogEntry = {
  id: string;
  level: "log" | "info" | "warn" | "error";
  message: string;
  createdAt: string;
};

export type StatisticsSummary = {
  rss: {
    totalRuns: number;
    successRuns: number;
    errorRuns: number;
    fetchedCount: number;
    insertedCount: number;
    updatedCount: number;
    skippedCount: number;
    convertedCount: number;
    conversionFailedCount: number;
    conversionSkippedCount: number;
    lastFinishedAt: string | null;
  };
  api: {
    totalLogs: number;
    requestCount: number;
    successLogs: number;
    errorLogs: number;
    skippedLogs: number;
    itemCount: number;
    promptChars: number;
    responseChars: number;
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
    lastFinishedAt: string | null;
  };
  recentRssRuns: RssRefreshRunSummary[];
  recentApiRequests: ApiRequestSummary[];
  recentArticleFetches: ArticleFetchSummary[];
};

export type RssRefreshRunSummary = {
  id: string;
  feedId: string;
  feedUrl: string;
  status: string;
  fetchedCount: number;
  insertedCount: number;
  updatedCount: number;
  skippedCount: number;
  convertedCount: number;
  conversionFailedCount: number;
  conversionSkippedCount: number;
  errorMessage: string | null;
  finishedAt: string;
};

export type ApiRequestSummary = {
  id: string;
  feedId: string | null;
  purpose: string;
  model: string;
  promptHash: string;
  status: string;
  requestCount: number;
  itemCount: number;
  promptChars: number;
  responseChars: number;
  promptTokenCount: number | null;
  candidatesTokenCount: number | null;
  totalTokenCount: number | null;
  cachedContentTokenCount: number | null;
  errorMessage: string | null;
  finishedAt: string;
};

export type FeedResidentPrompt = {
  feedId: string;
  prompt: string;
  promptHash: string;
  updatedAt: string;
};

export type ArticleFetchSummary = {
  id: string;
  feedItemId: string | null;
  url: string;
  status: string;
  robotsResult: string;
  elapsedMs: number;
  contentSize: number;
  errorMessage: string | null;
  fetchedAt: string;
};
