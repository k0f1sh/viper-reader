import { contextBridge, ipcRenderer } from "electron";
import type { appInfo } from "../shared/appInfo.js";
import type {
  AppLogEntry,
  FeedResidentPrompt,
  FeedSource,
  RefreshFeedResult,
  RefreshProgress,
  StatisticsSummary,
  ThreadDetail,
  ThreadGenerationStatus,
  ThreadListItem
} from "../shared/types.js";

export type ViperReaderApi = {
  getAppInfo: () => Promise<typeof appInfo>;
  listFeeds: () => Promise<FeedSource[]>;
  listThreads: (feedId: string) => Promise<ThreadListItem[]>;
  getThread: (threadId: string) => Promise<ThreadDetail | null>;
  generateThreadResponses: (threadId: string, force: boolean) => Promise<void>;
  postMessage: (threadId: string, name: string, mail: string, body: string) => Promise<ThreadDetail | null>;
  generateReplies: (threadId: string) => Promise<ThreadDetail | null>;
  toggleFavorite: (threadId: string, isFavorite: boolean) => Promise<void>;
  listFavoriteThreads: () => Promise<ThreadListItem[]>;
  refreshFeed: (feedId: string) => Promise<RefreshFeedResult>;
  onRefreshProgress: (callback: (progress: RefreshProgress) => void) => () => void;
  onThreadGenerationComplete: (callback: (status: ThreadGenerationStatus) => void) => () => void;
  onPostStatus: (callback: (data: { threadId: string; status: "writing" | "generating" | "done" | "error" }) => void) => () => void;
  listLogs: () => Promise<AppLogEntry[]>;
  onLogEntry: (callback: (entry: AppLogEntry) => void) => () => void;
  getStatistics: () => Promise<StatisticsSummary>;
  openExternalUrl: (url: string) => Promise<void>;
  getFeedResidentPrompt: (feedId: string) => Promise<FeedResidentPrompt | null>;
  saveFeedResidentPrompt: (feedId: string, prompt: string) => Promise<void>;
  clearFeedResidentPrompt: (feedId: string) => Promise<void>;
  getUserSetting: (key: string) => Promise<string | null>;
  saveUserSetting: (key: string, value: string) => Promise<void>;
  addFeedSource: (title: string, url: string) => Promise<FeedSource>;
  deleteFeedSource: (feedId: string) => Promise<void>;
};

const api: ViperReaderApi = {
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  listFeeds: () => ipcRenderer.invoke("feeds:list"),
  listThreads: (feedId) => ipcRenderer.invoke("threads:list", feedId),
  getThread: (threadId) => ipcRenderer.invoke("threads:get", threadId),
  generateThreadResponses: (threadId, force) => ipcRenderer.invoke("threads:generate", threadId, force),
  postMessage: (threadId, name, mail, body) => ipcRenderer.invoke("threads:post", threadId, name, mail, body),
  generateReplies: (threadId) => ipcRenderer.invoke("threads:generate-replies", threadId),
  toggleFavorite: (threadId, isFavorite) => ipcRenderer.invoke("threads:toggle-favorite", threadId, isFavorite),
  listFavoriteThreads: () => ipcRenderer.invoke("threads:list-favorites"),
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
  addFeedSource: (title, url) => ipcRenderer.invoke("feeds:add", title, url),
  deleteFeedSource: (feedId) => ipcRenderer.invoke("feeds:delete", feedId)
};

contextBridge.exposeInMainWorld("viperReader", api);
