import { app, BrowserWindow, clipboard, ipcMain, shell, Menu, session } from "electron";
import type { IpcMainInvokeEvent, Session } from "electron";
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
  countAllUnreadArticles,
  listResidentPromptVersions,
  reviewResidentPromptVersion,
  rollbackResidentPromptVersion,
  saveReplyFeedback,
  saveFeedResidentPrompt,
  setThreadFavorite,
  listFavoriteThreads,
  markFeedRead,
  markAllFeedsRead,
  setThreadRead,
  updateFeedTitleGenerationSetting
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
import { ArticleBlocker } from "./browser/articleBlocker.js";
import { ArticleBrowserController } from "./browser/articleBrowserController.js";
import { CHROME_USER_AGENT } from "./network/httpIdentity.js";
import type { ArticleBrowserBounds, ReplyRating, ShowArticleBrowserRequest } from "../shared/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnv();
installConsoleLogForwarder();

const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
const articleBrowserControllers = new Map<number, ArticleBrowserController>();
let articleSession: Session | null = null;
let articleBlocker: ArticleBlocker | null = null;

function getAppIconPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "icon.png")
    : path.join(app.getAppPath(), "assets/icon.png");
}

if (process.platform === "linux") {
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
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (!articleSession || !articleBlocker) {
    throw new Error("Article browser services are not initialized.");
  }
  const articleBrowser = new ArticleBrowserController(window, articleSession, articleBlocker);
  const rendererWebContentsId = window.webContents.id;
  articleBrowserControllers.set(rendererWebContentsId, articleBrowser);
  window.once("close", () => {
    articleBrowserControllers.delete(rendererWebContentsId);
    articleBrowser.destroy();
  });

  window.setMenu(null);

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
ipcMain.handle("threads:count-unread-articles", () => countAllUnreadArticles());
ipcMain.handle("threads:get", (_event, threadId: string) => {
  const thread = openThread(threadId);
  return thread;
});
ipcMain.handle("articles:get-body", (_event, threadId: string) => {
  const contentText = getArticleBody(threadId);
  return contentText ? { threadId, contentText } : null;
});
ipcMain.handle("article-browser:show", (event, request: ShowArticleBrowserRequest) => {
  assertShowArticleBrowserRequest(request);
  return getArticleBrowserController(event).show(request);
});
ipcMain.handle("article-browser:hide", (event) => getArticleBrowserController(event).hide());
ipcMain.handle("article-browser:set-bounds", (event, bounds: ArticleBrowserBounds) => {
  assertArticleBrowserBounds(bounds);
  getArticleBrowserController(event).setBounds(bounds);
});
ipcMain.handle("article-browser:back", (event) => getArticleBrowserController(event).goBack());
ipcMain.handle("article-browser:forward", (event) => getArticleBrowserController(event).goForward());
ipcMain.handle("article-browser:reload", (event) => getArticleBrowserController(event).reload());
ipcMain.handle("article-browser:scroll", (event, direction: number) => {
  if (direction !== -1 && direction !== 1) {
    throw new Error("Invalid article browser scroll direction.");
  }
  getArticleBrowserController(event).scroll(direction);
});
ipcMain.handle("article-browser:open-external", (event) => getArticleBrowserController(event).openExternal());
ipcMain.handle("article-browser:set-blocking-enabled", (event, enabled: boolean) => {
  if (typeof enabled !== "boolean") {
    throw new Error("Invalid blocker state.");
  }
  return getArticleBrowserController(event).setBlockingEnabled(enabled);
});
ipcMain.handle("article-browser:set-global-blocking-enabled", (event, enabled: boolean) => {
  if (typeof enabled !== "boolean") {
    throw new Error("Invalid global blocker state.");
  }
  saveRendererUserSetting("articleBrowserBlockingEnabled", String(enabled));
  return getArticleBrowserController(event).setGlobalBlockingEnabled(enabled);
});
ipcMain.handle("article-browser:retry-blocker", (event) => getArticleBrowserController(event).retryBlocker());
ipcMain.handle("article-browser:get-state", (event) => getArticleBrowserController(event).getState());
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
ipcMain.handle("logs:copy", (_event, text: string) => {
  if (typeof text !== "string") {
    throw new Error("コピーするログの形式が不正です。");
  }
  clipboard.writeText(text.slice(0, 1_000_000));
});
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
ipcMain.handle("feeds:add", (_event, title: string, url: string, generateTitleFromSummary: boolean) =>
  addFeedSource(title, url, generateTitleFromSummary)
);
ipcMain.handle("feeds:delete", (_event, feedId: string) => deleteFeedSource(feedId));
ipcMain.handle("feeds:update-title-generation-setting", (_event, feedId: string, generateTitleFromSummary: boolean) =>
  updateFeedTitleGenerationSetting(feedId, generateTitleFromSummary)
);
ipcMain.handle("shell:open-external", async (_event, url: string) => {
  const parsedUrl = new URL(url);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`Unsupported URL protocol: ${parsedUrl.protocol}`);
  }

  await shell.openExternal(parsedUrl.toString());
});

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  initializeRepository();
  articleSession = session.fromPartition("viper-reader-articles", { cache: false });
  articleSession.setUserAgent(CHROME_USER_AGENT);
  articleSession.setPermissionCheckHandler(() => false);
  articleSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  articleBlocker = new ArticleBlocker(articleSession);
  articleBlocker.setGloballyEnabled(
    getRendererUserSetting("articleBrowserBlockingEnabled") !== "false"
  );
  void articleBlocker.initialize();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

function getArticleBrowserController(event: IpcMainInvokeEvent): ArticleBrowserController {
  const controller = articleBrowserControllers.get(event.sender.id);
  if (!controller || !controller.ownsSender(event.sender.id)) {
    throw new Error("Unauthorized article browser request.");
  }
  return controller;
}

function assertShowArticleBrowserRequest(value: ShowArticleBrowserRequest): void {
  if (!value || typeof value.threadId !== "string" || typeof value.url !== "string") {
    throw new Error("Invalid article browser request.");
  }
  assertArticleBrowserBounds(value.bounds);
  if (typeof value.allowUnprotected !== "boolean") {
    throw new Error("Invalid unprotected browsing flag.");
  }
}

function assertArticleBrowserBounds(value: ArticleBrowserBounds): void {
  if (
    !value
    || !Number.isFinite(value.x)
    || !Number.isFinite(value.y)
    || !Number.isFinite(value.width)
    || !Number.isFinite(value.height)
  ) {
    throw new Error("Invalid article browser bounds.");
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
