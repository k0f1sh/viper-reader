import { contextBridge, ipcRenderer } from "electron";
import type { appInfo } from "../shared/appInfo.js";
import type {
  AppLogEntry,
  ArticleBrowserBounds,
  ArticleBrowserState,
  ArticleBodyContent,
  FeedResidentPrompt,
  FeedSource,
  GeminiApiKeyStatus,
  RefreshFeedResult,
  RefreshProgress,
  ReplyRating,
  ResidentPromptVersion,
  StatisticsSummary,
  ThreadDetail,
  ThreadGenerationStatus,
  ThreadListItem,
  ThreadListPage,
  ShowArticleBrowserRequest
} from "../shared/types.js";

export type ViperReaderApi = {
  getAppInfo: () => Promise<typeof appInfo>;
  listFeeds: () => Promise<FeedSource[]>;
  listThreads: (feedId: string | null, page: number, unreadOnly: boolean) => Promise<ThreadListPage>;
  countUnreadArticles: () => Promise<number>;
  getThread: (threadId: string) => Promise<ThreadDetail | null>;
  getArticleBody: (threadId: string) => Promise<ArticleBodyContent | null>;
  showArticleBrowser: (request: ShowArticleBrowserRequest) => Promise<ArticleBrowserState>;
  hideArticleBrowser: () => Promise<void>;
  setArticleBrowserBounds: (bounds: ArticleBrowserBounds) => Promise<void>;
  articleBrowserBack: () => Promise<void>;
  articleBrowserForward: () => Promise<void>;
  reloadArticleBrowser: () => Promise<void>;
  openArticleBrowserExternally: () => Promise<void>;
  setArticleBrowserBlockingEnabled: (enabled: boolean) => Promise<ArticleBrowserState>;
  retryArticleBrowserBlocker: () => Promise<ArticleBrowserState>;
  getArticleBrowserState: () => Promise<ArticleBrowserState>;
  onArticleBrowserState: (callback: (state: ArticleBrowserState) => void) => () => void;
  regenerateVipTitle: (threadId: string) => Promise<ThreadDetail | null>;
  generateThreadResponses: (threadId: string, force: boolean) => Promise<void>;
  postMessage: (threadId: string, name: string, mail: string, body: string) => Promise<ThreadDetail | null>;
  generateReplies: (threadId: string) => Promise<ThreadDetail | null>;
  toggleFavorite: (threadId: string, isFavorite: boolean) => Promise<void>;
  listFavoriteThreads: () => Promise<ThreadListItem[]>;
  setThreadRead: (threadId: string, isRead: boolean) => Promise<void>;
  markFeedRead: (feedId: string) => Promise<void>;
  markAllFeedsRead: () => Promise<void>;
  refreshFeed: (feedId: string) => Promise<RefreshFeedResult>;
  onRefreshProgress: (callback: (progress: RefreshProgress) => void) => () => void;
  onThreadGenerationComplete: (callback: (status: ThreadGenerationStatus) => void) => () => void;
  onPostStatus: (callback: (data: { threadId: string; status: "writing" | "generating" | "done" | "error" }) => void) => () => void;
  listLogs: () => Promise<AppLogEntry[]>;
  copyLogs: (text: string) => Promise<void>;
  onLogEntry: (callback: (entry: AppLogEntry) => void) => () => void;
  getStatistics: () => Promise<StatisticsSummary>;
  openExternalUrl: (url: string) => Promise<void>;
  getFeedResidentPrompt: (feedId: string) => Promise<FeedResidentPrompt | null>;
  saveFeedResidentPrompt: (feedId: string, prompt: string) => Promise<void>;
  clearFeedResidentPrompt: (feedId: string) => Promise<void>;
  rateReplyRun: (runId: string, rating: ReplyRating, tags: string[]) => Promise<void>;
  listResidentPromptVersions: (feedId: string) => Promise<ResidentPromptVersion[]>;
  reviewResidentPromptVersion: (id: string, decision: "active" | "rejected") => Promise<void>;
  rollbackResidentPromptVersion: (feedId: string) => Promise<void>;
  onPromptProposalReady: (callback: (data: { feedId: string; versionId: string }) => void) => () => void;
  getUserSetting: (key: string) => Promise<string | null>;
  saveUserSetting: (key: string, value: string) => Promise<void>;
  getGeminiApiKeyStatus: () => Promise<GeminiApiKeyStatus>;
  saveGeminiApiKey: (apiKey: string) => Promise<GeminiApiKeyStatus>;
  clearGeminiApiKey: () => Promise<GeminiApiKeyStatus>;
  addFeedSource: (title: string, url: string, generateTitleFromSummary: boolean) => Promise<FeedSource>;
  deleteFeedSource: (feedId: string) => Promise<void>;
  updateFeedTitleGenerationSetting: (feedId: string, generateTitleFromSummary: boolean) => Promise<FeedSource>;
};

const api: ViperReaderApi = {
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  listFeeds: () => ipcRenderer.invoke("feeds:list"),
  listThreads: (feedId, page, unreadOnly) => ipcRenderer.invoke("threads:list", feedId, page, unreadOnly),
  countUnreadArticles: () => ipcRenderer.invoke("threads:count-unread-articles"),
  getThread: (threadId) => ipcRenderer.invoke("threads:get", threadId),
  getArticleBody: (threadId) => ipcRenderer.invoke("articles:get-body", threadId),
  showArticleBrowser: (request) => ipcRenderer.invoke("article-browser:show", request),
  hideArticleBrowser: () => ipcRenderer.invoke("article-browser:hide"),
  setArticleBrowserBounds: (bounds) => ipcRenderer.invoke("article-browser:set-bounds", bounds),
  articleBrowserBack: () => ipcRenderer.invoke("article-browser:back"),
  articleBrowserForward: () => ipcRenderer.invoke("article-browser:forward"),
  reloadArticleBrowser: () => ipcRenderer.invoke("article-browser:reload"),
  openArticleBrowserExternally: () => ipcRenderer.invoke("article-browser:open-external"),
  setArticleBrowserBlockingEnabled: (enabled) => ipcRenderer.invoke("article-browser:set-blocking-enabled", enabled),
  retryArticleBrowserBlocker: () => ipcRenderer.invoke("article-browser:retry-blocker"),
  getArticleBrowserState: () => ipcRenderer.invoke("article-browser:get-state"),
  onArticleBrowserState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ArticleBrowserState) => callback(state);
    ipcRenderer.on("article-browser:state", listener);
    return () => ipcRenderer.removeListener("article-browser:state", listener);
  },
  regenerateVipTitle: (threadId) => ipcRenderer.invoke("threads:regenerate-title", threadId),
  generateThreadResponses: (threadId, force) => ipcRenderer.invoke("threads:generate", threadId, force),
  postMessage: (threadId, name, mail, body) => ipcRenderer.invoke("threads:post", threadId, name, mail, body),
  generateReplies: (threadId) => ipcRenderer.invoke("threads:generate-replies", threadId),
  toggleFavorite: (threadId, isFavorite) => ipcRenderer.invoke("threads:toggle-favorite", threadId, isFavorite),
  listFavoriteThreads: () => ipcRenderer.invoke("threads:list-favorites"),
  setThreadRead: (threadId, isRead) => ipcRenderer.invoke("threads:set-read", threadId, isRead),
  markFeedRead: (feedId) => ipcRenderer.invoke("feeds:mark-read", feedId),
  markAllFeedsRead: () => ipcRenderer.invoke("feeds:mark-all-read"),
  refreshFeed: (feedId) => ipcRenderer.invoke("feeds:refresh", feedId),
  onRefreshProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: RefreshProgress) => callback(progress);
    ipcRenderer.on("feeds:refresh-progress", listener);
    return () => {
      ipcRenderer.removeListener("feeds:refresh-progress", listener);
    };
  },
  onThreadGenerationComplete: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: ThreadGenerationStatus) => callback(status);
    ipcRenderer.on("threads:generation-complete", listener);
    return () => {
      ipcRenderer.removeListener("threads:generation-complete", listener);
    };
  },
  onPostStatus: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { threadId: string; status: any }) => callback(data);
    ipcRenderer.on("threads:post-status", listener);
    return () => {
      ipcRenderer.removeListener("threads:post-status", listener);
    };
  },
  listLogs: () => ipcRenderer.invoke("logs:list"),
  copyLogs: (text) => ipcRenderer.invoke("logs:copy", text),
  onLogEntry: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: AppLogEntry) => callback(entry);
    ipcRenderer.on("logs:entry", listener);
    return () => {
      ipcRenderer.removeListener("logs:entry", listener);
    };
  },
  getStatistics: () => ipcRenderer.invoke("stats:get"),
  openExternalUrl: (url) => ipcRenderer.invoke("shell:open-external", url),
  getFeedResidentPrompt: (feedId) => ipcRenderer.invoke("feeds:get-resident-prompt", feedId),
  saveFeedResidentPrompt: (feedId, prompt) => ipcRenderer.invoke("feeds:save-resident-prompt", feedId, prompt),
  clearFeedResidentPrompt: (feedId) => ipcRenderer.invoke("feeds:clear-resident-prompt", feedId),
  rateReplyRun: (runId, rating, tags) => ipcRenderer.invoke("threads:rate-reply-run", runId, rating, tags),
  listResidentPromptVersions: (feedId) => ipcRenderer.invoke("feeds:list-prompt-versions", feedId),
  reviewResidentPromptVersion: (id, decision) => ipcRenderer.invoke("feeds:review-prompt-version", id, decision),
  rollbackResidentPromptVersion: (feedId) => ipcRenderer.invoke("feeds:rollback-prompt-version", feedId),
  onPromptProposalReady: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, data: { feedId: string; versionId: string }) => callback(data);
    ipcRenderer.on("feeds:prompt-proposal-ready", listener);
    return () => ipcRenderer.removeListener("feeds:prompt-proposal-ready", listener);
  },
  getUserSetting: (key) => ipcRenderer.invoke("settings:get", key),
  saveUserSetting: (key, value) => ipcRenderer.invoke("settings:save", key, value),
  getGeminiApiKeyStatus: () => ipcRenderer.invoke("settings:get-gemini-api-key-status"),
  saveGeminiApiKey: (apiKey) => ipcRenderer.invoke("settings:save-gemini-api-key", apiKey),
  clearGeminiApiKey: () => ipcRenderer.invoke("settings:clear-gemini-api-key"),
  addFeedSource: (title, url, generateTitleFromSummary) => ipcRenderer.invoke("feeds:add", title, url, generateTitleFromSummary),
  deleteFeedSource: (feedId) => ipcRenderer.invoke("feeds:delete", feedId),
  updateFeedTitleGenerationSetting: (feedId, generateTitleFromSummary) =>
    ipcRenderer.invoke("feeds:update-title-generation-setting", feedId, generateTitleFromSummary)
};

contextBridge.exposeInMainWorld("viperReader", api);
