import { contextBridge, ipcRenderer } from "electron";
import type { appInfo } from "../shared/appInfo.js";
import type {
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
  refreshFeed: (feedId: string) => Promise<RefreshFeedResult>;
  onRefreshProgress: (callback: (progress: RefreshProgress) => void) => () => void;
  onThreadGenerationComplete: (callback: (status: ThreadGenerationStatus) => void) => () => void;
  getStatistics: () => Promise<StatisticsSummary>;
  openExternalUrl: (url: string) => Promise<void>;
  getFeedResidentPrompt: (feedId: string) => Promise<FeedResidentPrompt | null>;
  saveFeedResidentPrompt: (feedId: string, prompt: string) => Promise<void>;
  clearFeedResidentPrompt: (feedId: string) => Promise<void>;
  getUserSetting: (key: string) => Promise<string | null>;
  saveUserSetting: (key: string, value: string) => Promise<void>;
};

const api: ViperReaderApi = {
  getAppInfo: () => ipcRenderer.invoke("app:get-info"),
  listFeeds: () => ipcRenderer.invoke("feeds:list"),
  listThreads: (feedId) => ipcRenderer.invoke("threads:list", feedId),
  getThread: (threadId) => ipcRenderer.invoke("threads:get", threadId),
  generateThreadResponses: (threadId, force) => ipcRenderer.invoke("threads:generate", threadId, force),
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
  getStatistics: () => ipcRenderer.invoke("stats:get"),
  openExternalUrl: (url) => ipcRenderer.invoke("shell:open-external", url),
  getFeedResidentPrompt: (feedId) => ipcRenderer.invoke("feeds:get-resident-prompt", feedId),
  saveFeedResidentPrompt: (feedId, prompt) => ipcRenderer.invoke("feeds:save-resident-prompt", feedId, prompt),
  clearFeedResidentPrompt: (feedId) => ipcRenderer.invoke("feeds:clear-resident-prompt", feedId),
  getUserSetting: (key) => ipcRenderer.invoke("settings:get", key),
  saveUserSetting: (key, value) => ipcRenderer.invoke("settings:save", key, value)
};

contextBridge.exposeInMainWorld("viperReader", api);
