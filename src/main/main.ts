import { app, BrowserWindow, ipcMain, shell, Menu } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appInfo } from "../shared/appInfo.js";
import {
  addFeedSource,
  clearFeedResidentPrompt,
  deleteFeedSource,
  getFeedResidentPrompt,
  getArticleBody,
  getStatistics,
  initializeRepository,
  listFeeds,
  listThreads,
  listResidentPromptVersions,
  reviewResidentPromptVersion,
  rollbackResidentPromptVersion,
  saveReplyFeedback,
  saveFeedResidentPrompt,
  setThreadFavorite,
  listFavoriteThreads,
  markFeedRead,
  markAllFeedsRead,
  setThreadRead
} from "./db/repository.js";
import { loadEnv } from "./env/loadEnv.js";
import { installConsoleLogForwarder, listBufferedLogs } from "./log/logBroadcaster.js";
import { refreshFeed } from "./rss/refreshFeed.js";
import {
  clearGeminiApiKey,
  getGeminiApiKeyStatus,
  getRendererUserSetting,
  saveGeminiApiKey,
  saveRendererUserSetting
} from "./settings/settingsService.js";
import { openThread, startThreadResponseGeneration } from "./threads/openThread.js";
import { postThreadMessage, generateRepliesOnly } from "./threads/postMessage.js";
import { regenerateVipTitle } from "./threads/regenerateVipTitle.js";
import { maybeCreatePromptProposal } from "./ai/promptOptimizer.js";
import type { ReplyRating } from "../shared/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnv();
installConsoleLogForwarder();

const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;

function getAppIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(app.getAppPath(), "assets/icon.png");
}

if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
  app.commandLine.appendSwitch("class", "viper-reader");
}

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 600,
    title: appInfo.name,
    icon: getAppIconPath(),
    backgroundColor: "#efeffc",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  window.webContents.on("context-menu", (_event, params) => {
    if (params.selectionText) {
      Menu.buildFromTemplate([
        { role: "copy", label: "コピー" }
      ]).popup({ window });
    }
  });

  if (isDev) {
    void window.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    return;
  }

  void window.loadFile(path.join(__dirname, "../renderer/index.html"));
}

ipcMain.handle("app:get-info", () => appInfo);
ipcMain.handle("feeds:list", () => listFeeds());
ipcMain.handle("threads:list", (_event, feedId: string | null, page: number, unreadOnly: boolean) =>
  listThreads(feedId, page, 100, unreadOnly)
);
ipcMain.handle("threads:get", (_event, threadId: string) => {
  const thread = openThread(threadId);
  return thread;
});
ipcMain.handle("articles:get-body", (_event, threadId: string) => {
  const contentText = getArticleBody(threadId);
  return contentText ? { threadId, contentText } : null;
});
ipcMain.handle("threads:generate", (event, threadId: string, force: boolean) => {
  startThreadResponseGeneration(threadId, force, (status) => {
    event.sender.send("threads:generation-complete", { threadId, status });
  });
});
ipcMain.handle("threads:regenerate-title", (_event, threadId: string) => regenerateVipTitle(threadId));
ipcMain.handle("threads:post", (event, threadId: string, name: string, mail: string, body: string) => {
  return postThreadMessage(threadId, name, mail, body, (status) => {
    event.sender.send("threads:post-status", { threadId, status });
  });
});
ipcMain.handle("threads:generate-replies", (event, threadId: string) => {
  return generateRepliesOnly(threadId, (status) => {
    event.sender.send("threads:post-status", { threadId, status });
  });
});
ipcMain.handle("threads:toggle-favorite", (_event, threadId: string, isFavorite: boolean) => setThreadFavorite(threadId, isFavorite));
ipcMain.handle("threads:list-favorites", () => listFavoriteThreads());
ipcMain.handle("threads:set-read", (_event, threadId: string, isRead: boolean) => setThreadRead(threadId, isRead));
ipcMain.handle("feeds:mark-read", (_event, feedId: string) => markFeedRead(feedId));
ipcMain.handle("feeds:mark-all-read", () => markAllFeedsRead());
ipcMain.handle("feeds:refresh", async (event, feedId: string) =>
  refreshFeed(feedId, (message) => {
    event.sender.send("feeds:refresh-progress", { feedId, message });
  })
);
ipcMain.handle("stats:get", () => getStatistics());
ipcMain.handle("logs:list", () => listBufferedLogs());
ipcMain.handle("feeds:get-resident-prompt", (_event, feedId: string) => getFeedResidentPrompt(feedId));
ipcMain.handle("feeds:save-resident-prompt", (_event, feedId: string, prompt: string) => saveFeedResidentPrompt(feedId, prompt));
ipcMain.handle("feeds:clear-resident-prompt", (_event, feedId: string) => clearFeedResidentPrompt(feedId));
ipcMain.handle("threads:rate-reply-run", (event, runId: string, rating: ReplyRating, tags: string[]) => {
  const feedId = saveReplyFeedback(runId, rating, tags);
  void maybeCreatePromptProposal(feedId).then((versionId) => {
    if (versionId && !event.sender.isDestroyed()) event.sender.send("feeds:prompt-proposal-ready", { feedId, versionId });
  }).catch((error) => console.error("住民プロンプト改善案の生成に失敗しました:", error));
});
ipcMain.handle("feeds:list-prompt-versions", (_event, feedId: string) => listResidentPromptVersions(feedId));
ipcMain.handle("feeds:review-prompt-version", (_event, id: string, decision: "active" | "rejected") => reviewResidentPromptVersion(id, decision));
ipcMain.handle("feeds:rollback-prompt-version", (_event, feedId: string) => rollbackResidentPromptVersion(feedId));
ipcMain.handle("settings:get", (_event, key: string) => getRendererUserSetting(key));
ipcMain.handle("settings:save", (_event, key: string, value: string) => saveRendererUserSetting(key, value));
ipcMain.handle("settings:get-gemini-api-key-status", () => getGeminiApiKeyStatus());
ipcMain.handle("settings:save-gemini-api-key", (_event, apiKey: string) => saveGeminiApiKey(apiKey));
ipcMain.handle("settings:clear-gemini-api-key", () => clearGeminiApiKey());
ipcMain.handle("feeds:add", (_event, title: string, url: string) => addFeedSource(title, url));
ipcMain.handle("feeds:delete", (_event, feedId: string) => deleteFeedSource(feedId));
ipcMain.handle("shell:open-external", async (_event, url: string) => {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${parsedUrl.protocol}`);
  }

  await shell.openExternal(parsedUrl.toString());
});

void app.whenReady().then(() => {
  initializeRepository();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
