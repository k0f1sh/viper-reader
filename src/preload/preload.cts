import { contextBridge, ipcRenderer } from "electron";
import type { appInfo } from "../shared/appInfo.js";
import type {
  AppLogEntry,
  ArticleBrowserBounds,
  ArticleBrowserState,
  ArticleBodyContent,
  FeedResidentPrompt,
  FeedSource,
  FeedFolder,
  FeedTreePlacement,
  GeminiApiKeyStatus,
  RefreshFeedResult,
  RefreshProgress,
  ReadingQueueSummary,
  StatisticsSummary,
  ThreadDetail,
  ThreadGenerationAttempt,
  TitleGenerationAttempt,
  ThreadGenerationStatus,
  ThreadGenerationProgress,
  ThreadListItem,
  ThreadListPage,
  ShowArticleBrowserRequest
} from "../shared/types.js";

export type ViperReaderApi = {
  getAppInfo: () => Promise<typeof appInfo>;
  listFeeds: () => Promise<FeedSource[]>;
  listThreads: (feedId: string | null, page: number, unreadOnly: boolean) => Promise<ThreadListPage>;
  listGeneratedQueue: (page: number) => Promise<ThreadListPage>;
  listReviewedGenerationQueue: (page: number) => Promise<ThreadListPage>;
  getReadingQueueSummary: () => Promise<ReadingQueueSummary>;
  markThreadGenerationReviewed: (threadId: string) => Promise<void>;
  listThreadGenerationAttempts: (threadId: string) => Promise<ThreadGenerationAttempt[]>;
  listTitleGenerationAttempts: (threadId: string) => Promise<TitleGenerationAttempt[]>;
  countUnreadArticles: () => Promise<number>;
  getThread: (threadId: string) => Promise<ThreadDetail | null>;
  getArticleBody: (threadId: string) => Promise<ArticleBodyContent | null>;
  showArticleBrowser: (request: ShowArticleBrowserRequest) => Promise<ArticleBrowserState>;
  hideArticleBrowser: () => Promise<void>;
  setArticleBrowserBounds: (bounds: ArticleBrowserBounds) => Promise<void>;
  articleBrowserBack: () => Promise<void>;
  articleBrowserForward: () => Promise<void>;
  reloadArticleBrowser: () => Promise<void>;
  scrollArticleBrowser: (direction: -1 | 1) => Promise<void>;
  openArticleBrowserExternally: () => Promise<void>;
  setArticleBrowserBlockingEnabled: (enabled: boolean) => Promise<ArticleBrowserState>;
  setArticleBrowserGlobalBlockingEnabled: (enabled: boolean) => Promise<ArticleBrowserState>;
  retryArticleBrowserBlocker: () => Promise<ArticleBrowserState>;
  getArticleBrowserState: () => Promise<ArticleBrowserState>;
  onArticleBrowserState: (callback: (state: ArticleBrowserState) => void) => () => void;
  onToggleArticleBrowserExpanded: (callback: () => void) => () => void;
  regenerateThreadTitle: (threadId: string) => Promise<ThreadDetail | null>;
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
  onThreadGenerationProgress: (callback: (progress: ThreadGenerationProgress) => void) => () => void;
  onPostStatus: (callback: (data: { threadId: string; status: "writing" | "generating" | "done" | "error"; errorMessage?: string }) => void) => () => void;
  listLogs: () => Promise<AppLogEntry[]>;
  copyLogs: (text: string) => Promise<void>;
  onLogEntry: (callback: (entry: AppLogEntry) => void) => () => void;
  getStatistics: () => Promise<StatisticsSummary>;
  openExternalUrl: (url: string) => Promise<void>;
  getFeedResidentPrompt: (feedId: string) => Promise<FeedResidentPrompt | null>;
  saveFeedResidentPrompt: (feedId: string, prompt: string) => Promise<void>;
  clearFeedResidentPrompt: (feedId: string) => Promise<void>;
  getUserSetting: (key: string) => Promise<string | null>;
  saveUserSetting: (key: string, value: string) => Promise<void>;
  getGeminiApiKeyStatus: () => Promise<GeminiApiKeyStatus>;
  saveGeminiApiKey: (apiKey: string) => Promise<GeminiApiKeyStatus>;
  clearGeminiApiKey: () => Promise<GeminiApiKeyStatus>;
  addFeedSource: (title: string, url: string, generateTitleFromSummary: boolean, skipTitleConversion: boolean, parentFolderId: string | null) => Promise<FeedSource>;
  deleteFeedSource: (feedId: string) => Promise<void>;
  reorderFeedSources: (feedIds: string[]) => Promise<void>;
  updateFeedSettings: (feedId: string, title: string, generateTitleFromSummary: boolean, skipTitleConversion: boolean, defaultToArticleBrowser: boolean) => Promise<FeedSource>;
  listFeedFolders: () => Promise<FeedFolder[]>;
  createFeedFolder: (name: string, parentFolderId: string | null) => Promise<FeedFolder>;
  renameFeedFolder: (folderId: string, name: string) => Promise<FeedFolder>;
  deleteFeedFolder: (folderId: string) => Promise<void>;
  saveFeedTreeLayout: (placements: FeedTreePlacement[]) => Promise<void>;
};

const api: ViperReaderApi = {
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  listFeeds: () => ipcRenderer.invoke("feeds:list"),
  listThreads: (feedId, page, unreadOnly) => ipcRenderer.invoke("threads:list", feedId, page, unreadOnly),
  listGeneratedQueue: (page) => ipcRenderer.invoke("threads:list-generated-queue", page),
  listReviewedGenerationQueue: (page) => ipcRenderer.invoke("threads:list-reviewed-generation-queue", page),
  getReadingQueueSummary: () => ipcRenderer.invoke("threads:get-queue-summary"),
  markThreadGenerationReviewed: (threadId) => ipcRenderer.invoke("threads:mark-generation-reviewed", threadId),
  listThreadGenerationAttempts: (threadId) => ipcRenderer.invoke("threads:list-generation-attempts", threadId),
  listTitleGenerationAttempts: (threadId) => ipcRenderer.invoke("threads:list-title-generation-attempts", threadId),
  countUnreadArticles: () => ipcRenderer.invoke("threads:count-unread-articles"),
  getThread: (threadId) => ipcRenderer.invoke("threads:get", threadId),
  getArticleBody: (threadId) => ipcRenderer.invoke("articles:get-body", threadId),
  showArticleBrowser: (request) => ipcRenderer.invoke("article-browser:show", request),
  hideArticleBrowser: () => ipcRenderer.invoke("article-browser:hide"),
  setArticleBrowserBounds: (bounds) => ipcRenderer.invoke("article-browser:set-bounds", bounds),
  articleBrowserBack: () => ipcRenderer.invoke("article-browser:back"),
  articleBrowserForward: () => ipcRenderer.invoke("article-browser:forward"),
  reloadArticleBrowser: () => ipcRenderer.invoke("article-browser:reload"),
  scrollArticleBrowser: (direction) => ipcRenderer.invoke("article-browser:scroll", direction),
  openArticleBrowserExternally: () => ipcRenderer.invoke("article-browser:open-external"),
  setArticleBrowserBlockingEnabled: (enabled) => ipcRenderer.invoke("article-browser:set-blocking-enabled", enabled),
  setArticleBrowserGlobalBlockingEnabled: (enabled) => ipcRenderer.invoke("article-browser:set-global-blocking-enabled", enabled),
  retryArticleBrowserBlocker: () => ipcRenderer.invoke("article-browser:retry-blocker"),
  getArticleBrowserState: () => ipcRenderer.invoke("article-browser:get-state"),
  onArticleBrowserState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ArticleBrowserState) => callback(state);
    ipcRenderer.on("article-browser:state", listener);
    return () => ipcRenderer.removeListener("article-browser:state", listener);
  },
  onToggleArticleBrowserExpanded: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("article-browser:toggle-expanded", listener);
    return () => ipcRenderer.removeListener("article-browser:toggle-expanded", listener);
  },
  regenerateThreadTitle: (threadId) => ipcRenderer.invoke("threads:regenerate-title", threadId),
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
  onThreadGenerationProgress: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: ThreadGenerationProgress) => callback(progress);
    ipcRenderer.on("threads:generation-progress", listener);
    return () => {
      ipcRenderer.removeListener("threads:generation-progress", listener);
    };
  },
  onPostStatus: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: { threadId: string; status: "writing" | "generating" | "done" | "error"; errorMessage?: string }
    ) => callback(data);
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
  getUserSetting: (key) => ipcRenderer.invoke("settings:get", key),
  saveUserSetting: (key, value) => ipcRenderer.invoke("settings:save", key, value),
  getGeminiApiKeyStatus: () => ipcRenderer.invoke("settings:get-gemini-api-key-status"),
  saveGeminiApiKey: (apiKey) => ipcRenderer.invoke("settings:save-gemini-api-key", apiKey),
  clearGeminiApiKey: () => ipcRenderer.invoke("settings:clear-gemini-api-key"),
  addFeedSource: (title, url, generateTitleFromSummary, skipTitleConversion, parentFolderId) => ipcRenderer.invoke("feeds:add", title, url, generateTitleFromSummary, skipTitleConversion, parentFolderId),
  deleteFeedSource: (feedId) => ipcRenderer.invoke("feeds:delete", feedId),
  reorderFeedSources: (feedIds) => ipcRenderer.invoke("feeds:reorder", feedIds),
  updateFeedSettings: (feedId, title, generateTitleFromSummary, skipTitleConversion, defaultToArticleBrowser) =>
    ipcRenderer.invoke("feeds:update-settings", feedId, title, generateTitleFromSummary, skipTitleConversion, defaultToArticleBrowser),
  listFeedFolders: () => ipcRenderer.invoke("feed-folders:list"),
  createFeedFolder: (name, parentFolderId) => ipcRenderer.invoke("feed-folders:create", name, parentFolderId),
  renameFeedFolder: (folderId, name) => ipcRenderer.invoke("feed-folders:rename", folderId, name),
  deleteFeedFolder: (folderId) => ipcRenderer.invoke("feed-folders:delete", folderId),
  saveFeedTreeLayout: (placements) => ipcRenderer.invoke("feed-tree:save-layout", placements)
};

contextBridge.exposeInMainWorld("viperReader", api);
