import { app, BrowserWindow, clipboard, ipcMain as electronIpcMain, shell, Menu, session } from "electron";
import type { IpcMainInvokeEvent, Session } from "electron";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appInfo } from "../shared/appInfo.js";
import {
  getArticleBody,
  getStatistics,
  initializeRepository,
  listThreads,
  listGeneratedQueue,
  listThreadGenerationAttempts,
  listTitleGenerationAttempts,
  getReadingQueueSummary,
  countAllUnreadArticles,
  setThreadFavorite,
  listFavoriteThreads,
  setThreadRead,
  setThreadGenerationState,
  markThreadGenerationReviewed
} from "./db/repository.js";
import {
  addFeedSource,
  deleteFeedSource,
  listFeeds,
  markAllFeedsRead,
  markFeedRead,
  reorderFeedSources,
  updateFeedSettings
} from "./db/feedRepository.js";
import {
  createFeedFolder,
  deleteFeedFolder,
  listFeedFolders,
  renameFeedFolder,
  saveFeedTreeLayout
} from "./db/feedFolderRepository.js";
import {
  clearFeedResidentPrompt,
  getFeedResidentPrompt,
  saveFeedResidentPrompt
} from "./db/residentPromptRepository.js";
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
import { regenerateThreadTitle } from "./threads/regenerateThreadTitle.js";
import { ArticleBlocker } from "./browser/articleBlocker.js";
import { ArticleBrowserController } from "./browser/articleBrowserController.js";
import { ARTICLE_BROWSER_USER_AGENT } from "./network/httpIdentity.js";
import type { ArticleBrowserBounds, FeedTreePlacement, ShowArticleBrowserRequest } from "../shared/types.js";
import { sendIfAvailable } from "./ipc/safeSender.js";
import {
  assertArticleBrowserBounds,
  assertBoolean,
  assertFeedTreePlacements,
  assertHttpUrl,
  assertIdentifier,
  assertNullableIdentifier,
  assertPage,
  assertShowArticleBrowserRequest,
  assertString,
  assertStringArray
} from "./ipc/inputValidation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnv();
installConsoleLogForwarder();

const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;
const rendererEntryUrl = isDev
  ? new URL(process.env.VITE_DEV_SERVER_URL as string).toString()
  : pathToFileURL(path.join(__dirname, "../renderer/index.html")).toString();
const screenshotPathArg = process.argv.find((arg) => arg.startsWith("--screenshot-path="));
const screenshotPath = screenshotPathArg
  ? path.resolve(screenshotPathArg.substring("--screenshot-path=".length))
  : null;
const articleBrowserScreenshotPathArg = process.argv.find((arg) =>
  arg.startsWith("--article-browser-screenshot-path=")
);
const articleBrowserScreenshotPath = articleBrowserScreenshotPathArg
  ? path.resolve(articleBrowserScreenshotPathArg.substring("--article-browser-screenshot-path=".length))
  : null;
const isScreenshotMode = screenshotPath !== null || articleBrowserScreenshotPath !== null;
const articleBrowserControllers = new Map<number, ArticleBrowserController>();
let articleSession: Session | null = null;
let articleBlocker: ArticleBlocker | null = null;

const ipcMain = {
  handle(
    channel: string,
    listener: Parameters<typeof electronIpcMain.handle>[1]
  ): void {
    electronIpcMain.handle(channel, (event, ...args) => {
      assertTrustedIpcSender(event);
      return listener(event, ...args);
    });
  }
};

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
    width: isScreenshotMode ? 1600 : 1180,
    height: isScreenshotMode ? 1000 : 760,
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
  const articleBrowser = new ArticleBrowserController(
    window,
    articleSession,
    articleBlocker,
    articleBrowserScreenshotPath !== null
  );
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
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) {
      event.preventDefault();
    }
  });

  void window.loadURL(rendererEntryUrl);
  if (isScreenshotMode) {
    window.webContents.once("did-finish-load", () => {
      setTimeout(() => {
        void window.webContents.executeJavaScript(`
          (() => {
            const rows = [...document.querySelectorAll('.thread-row')];
            const generated = rows.find((row) => Number(row.querySelector('.thread-count')?.textContent ?? 0) > 0);
            (generated ?? rows[0])?.click();
          })();
        `).then(() => delay(2500))
          .then(async () => {
            if (screenshotPath) {
              const image = await window.capturePage();
              await writeFile(screenshotPath, image.toPNG());
            }
            if (articleBrowserScreenshotPath) {
              await window.webContents.executeJavaScript(`
                (() => {
                  const buttons = [...document.querySelectorAll('button')];
                  buttons.find((button) => button.textContent?.trim() === '元記事')?.click();
                })();
              `);
              await waitForArticleBrowser(articleBrowser);
              const articleImage = await articleBrowser.capturePageForScreenshot();
              await window.webContents.executeJavaScript(`
                (() => {
                  const viewport = document.querySelector('.article-browser-viewport');
                  if (!viewport) throw new Error('内蔵ブラウザの表示領域が見つかりません。');
                  const image = document.createElement('img');
                  image.src = ${JSON.stringify(articleImage.toDataURL())};
                  image.alt = '';
                  image.style.cssText = 'display:block;width:100%;height:100%;object-fit:cover;object-position:top left';
                  viewport.replaceChildren(image);
                })();
              `);
              await delay(100);
              const image = await window.capturePage();
              await writeFile(articleBrowserScreenshotPath, image.toPNG());
            }
            app.quit();
          }).catch((error) => {
            console.error("スクリーンショットの保存に失敗しました:", error);
            app.exit(1);
          });
      }, 1500);
    });
  }
}

ipcMain.handle("app:get-info", () => appInfo);
ipcMain.handle("feeds:list", () => listFeeds());
ipcMain.handle("threads:list", (_event, feedId: string | null, page: number, unreadOnly: boolean) => {
  if (feedId !== null) assertIdentifier(feedId, "feed ID");
  assertPage(page);
  assertBoolean(unreadOnly, "unread-only flag");
  return listThreads(feedId, page, 100, unreadOnly);
});
ipcMain.handle("threads:list-generated-queue", (_event, page: number) => {
  assertPage(page);
  return listGeneratedQueue(page, 100);
});
ipcMain.handle("threads:list-reviewed-generation-queue", (_event, page: number) => {
  assertPage(page);
  return listGeneratedQueue(page, 100, true);
});
ipcMain.handle("threads:get-queue-summary", () => getReadingQueueSummary());
ipcMain.handle("threads:mark-generation-reviewed", (_event, threadId: string) => {
  assertIdentifier(threadId, "thread ID");
  return markThreadGenerationReviewed(threadId);
});
ipcMain.handle("threads:list-generation-attempts", (_event, threadId: string) => {
  assertIdentifier(threadId, "thread ID");
  return listThreadGenerationAttempts(threadId, 5);
});
ipcMain.handle("threads:list-title-generation-attempts", (_event, threadId: string) => {
  assertIdentifier(threadId, "thread ID");
  return listTitleGenerationAttempts(threadId, 5);
});
ipcMain.handle("threads:count-unread-articles", () => countAllUnreadArticles());
ipcMain.handle("threads:get", (_event, threadId: string) => {
  assertIdentifier(threadId, "thread ID");
  const thread = openThread(threadId);
  return thread;
});
ipcMain.handle("articles:get-body", (_event, threadId: string) => {
  assertIdentifier(threadId, "thread ID");
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
  assertIdentifier(threadId, "thread ID");
  assertBoolean(force, "force flag");
  setThreadGenerationState(threadId, "queued");
  startThreadResponseGeneration(threadId, force, (status) => {
    setThreadGenerationState(threadId, status === "done" || status === "skipped" ? "completed" : "failed");
    sendIfAvailable(event.sender, "threads:generation-complete", { threadId, status });
  }, (progress) => {
    setThreadGenerationState(threadId, "generating");
    sendIfAvailable(event.sender, "threads:generation-progress", { threadId, ...progress });
  });
});
ipcMain.handle("threads:regenerate-title", (_event, threadId: string) => {
  assertIdentifier(threadId, "thread ID");
  return regenerateThreadTitle(threadId);
});
ipcMain.handle("threads:post", (event, threadId: string, name: string, mail: string, body: string) => {
  assertIdentifier(threadId, "thread ID");
  assertString(name, "name", { maxLength: 80 });
  assertString(mail, "mail", { maxLength: 20 });
  assertString(body, "post body", { minLength: 1, maxLength: 10_000 });
  return postThreadMessage(threadId, name, mail, body, (status, errorMessage) => {
    sendIfAvailable(event.sender, "threads:post-status", { threadId, status, errorMessage });
  });
});
ipcMain.handle("threads:generate-replies", (event, threadId: string) => {
  assertIdentifier(threadId, "thread ID");
  return generateRepliesOnly(threadId, (status, errorMessage) => {
    sendIfAvailable(event.sender, "threads:post-status", { threadId, status, errorMessage });
  });
});
ipcMain.handle("threads:toggle-favorite", (_event, threadId: string, isFavorite: boolean) => {
  assertIdentifier(threadId, "thread ID");
  assertBoolean(isFavorite, "favorite flag");
  return setThreadFavorite(threadId, isFavorite);
});
ipcMain.handle("threads:list-favorites", () => listFavoriteThreads());
ipcMain.handle("threads:set-read", (_event, threadId: string, isRead: boolean) => {
  assertIdentifier(threadId, "thread ID");
  assertBoolean(isRead, "read flag");
  return setThreadRead(threadId, isRead);
});
ipcMain.handle("feeds:mark-read", (_event, feedId: string) => {
  assertIdentifier(feedId, "feed ID");
  return markFeedRead(feedId);
});
ipcMain.handle("feeds:mark-all-read", () => markAllFeedsRead());
ipcMain.handle("feeds:refresh", async (event, feedId: string) => {
  assertIdentifier(feedId, "feed ID");
  return refreshFeed(feedId, (message) => {
    sendIfAvailable(event.sender, "feeds:refresh-progress", { feedId, message });
  });
});
ipcMain.handle("stats:get", () => getStatistics());
ipcMain.handle("logs:list", () => listBufferedLogs());
ipcMain.handle("logs:copy", (_event, text: string) => {
  if (typeof text !== "string") {
    throw new Error("コピーするログの形式が不正です。");
  }
  clipboard.writeText(text.slice(0, 1_000_000));
});
ipcMain.handle("feeds:get-resident-prompt", (_event, feedId: string) => {
  assertIdentifier(feedId, "feed ID");
  return getFeedResidentPrompt(feedId);
});
ipcMain.handle("feeds:save-resident-prompt", (_event, feedId: string, prompt: string) => {
  assertIdentifier(feedId, "feed ID");
  assertString(prompt, "resident prompt", { minLength: 1, maxLength: 20_000 });
  return saveFeedResidentPrompt(feedId, prompt);
});
ipcMain.handle("feeds:clear-resident-prompt", (_event, feedId: string) => {
  assertIdentifier(feedId, "feed ID");
  return clearFeedResidentPrompt(feedId);
});
ipcMain.handle("settings:get", (_event, key: string) => {
  assertString(key, "setting key", { minLength: 1, maxLength: 100 });
  return getRendererUserSetting(key);
});
ipcMain.handle("settings:save", (_event, key: string, value: string) => {
  assertString(key, "setting key", { minLength: 1, maxLength: 100 });
  assertString(value, "setting value", { maxLength: 1_000_000 });
  return saveRendererUserSetting(key, value);
});
ipcMain.handle("settings:get-gemini-api-key-status", () => getGeminiApiKeyStatus());
ipcMain.handle("settings:save-gemini-api-key", (_event, apiKey: string) => {
  assertString(apiKey, "Gemini API key", { minLength: 1, maxLength: 10_000 });
  return saveGeminiApiKey(apiKey);
});
ipcMain.handle("settings:clear-gemini-api-key", () => clearGeminiApiKey());
ipcMain.handle("feeds:add", (_event, title: string, url: string, generateTitleFromSummary: boolean, skipTitleConversion: boolean, parentFolderId: string | null) => {
  assertString(title, "feed title", { minLength: 1, maxLength: 200 });
  assertHttpUrl(url, "feed URL");
  assertBoolean(generateTitleFromSummary, "title generation flag");
  assertBoolean(skipTitleConversion, "skip title conversion flag");
  assertNullableIdentifier(parentFolderId, "parent folder ID");
  return addFeedSource(title, url, generateTitleFromSummary, skipTitleConversion, parentFolderId);
});
ipcMain.handle("feeds:delete", (_event, feedId: string) => {
  assertIdentifier(feedId, "feed ID");
  return deleteFeedSource(feedId);
});
ipcMain.handle("feeds:reorder", (_event, feedIds: string[]) => {
  assertStringArray(feedIds, "feed order", { maxItems: 10_000, maxItemLength: 512 });
  reorderFeedSources(feedIds);
});
ipcMain.handle("feed-folders:list", () => listFeedFolders());
ipcMain.handle("feed-folders:create", (_event, name: string, parentFolderId: string | null) => {
  assertString(name, "folder name", { minLength: 1, maxLength: 200 });
  assertNullableIdentifier(parentFolderId, "parent folder ID");
  return createFeedFolder(name, parentFolderId);
});
ipcMain.handle("feed-folders:rename", (_event, folderId: string, name: string) => {
  assertIdentifier(folderId, "folder ID");
  assertString(name, "folder name", { minLength: 1, maxLength: 200 });
  return renameFeedFolder(folderId, name);
});
ipcMain.handle("feed-folders:delete", (_event, folderId: string) => {
  assertIdentifier(folderId, "folder ID");
  deleteFeedFolder(folderId);
});
ipcMain.handle("feed-tree:save-layout", (_event, placements: FeedTreePlacement[]) => {
  assertFeedTreePlacements(placements);
  saveFeedTreeLayout(placements);
});
ipcMain.handle("feeds:update-settings", (_event, feedId: string, title: string, generateTitleFromSummary: boolean, skipTitleConversion: boolean, defaultToArticleBrowser: boolean) => {
  assertIdentifier(feedId, "feed ID");
  assertString(title, "feed title", { minLength: 1, maxLength: 200 });
  assertBoolean(generateTitleFromSummary, "title generation flag");
  assertBoolean(skipTitleConversion, "skip title conversion flag");
  assertBoolean(defaultToArticleBrowser, "default article browser flag");
  return updateFeedSettings(feedId, title, generateTitleFromSummary, skipTitleConversion, defaultToArticleBrowser);
});
ipcMain.handle("shell:open-external", async (_event, url: string) => {
  assertHttpUrl(url, "external URL");
  await shell.openExternal(new URL(url).toString());
});

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  initializeRepository(!isScreenshotMode);
  articleSession = session.fromPartition("viper-reader-articles", { cache: false });
  articleSession.setUserAgent(ARTICLE_BROWSER_USER_AGENT);
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

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForArticleBrowser(controller: ArticleBrowserController): Promise<void> {
  const timeoutAt = Date.now() + 10_000;
  while (Date.now() < timeoutAt) {
    const state = controller.getState();
    if (state.threadId && !state.isLoading && !state.error) {
      await delay(500);
      return;
    }
    await delay(100);
  }
  throw new Error("内蔵ブラウザの読み込みがタイムアウトしました。");
}

function getArticleBrowserController(event: IpcMainInvokeEvent): ArticleBrowserController {
  const controller = articleBrowserControllers.get(event.sender.id);
  if (!controller || !controller.ownsSender(event.sender.id)) {
    throw new Error("Unauthorized article browser request.");
  }
  return controller;
}

function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  if (
    event.sender.isDestroyed()
    || !articleBrowserControllers.has(event.sender.id)
    || !event.senderFrame
    || !isTrustedRendererUrl(event.senderFrame.url)
  ) {
    throw new Error("Unauthorized IPC request.");
  }
}

function isTrustedRendererUrl(value: string): boolean {
  try {
    const candidate = new URL(value);
    const expected = new URL(rendererEntryUrl);
    candidate.hash = "";
    candidate.search = "";
    expected.hash = "";
    expected.search = "";
    return candidate.toString() === expected.toString();
  } catch {
    return false;
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
