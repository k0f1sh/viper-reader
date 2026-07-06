import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appInfo } from "../shared/appInfo.js";
import {
  addFeedSource,
  clearFeedResidentPrompt,
  deleteFeedSource,
  getFeedResidentPrompt,
  getStatistics,
  getUserSetting,
  initializeRepository,
  listFeeds,
  listThreads,
  saveFeedResidentPrompt,
  saveUserSetting
} from "./db/repository.js";
import { loadEnv } from "./env/loadEnv.js";
import { refreshFeed } from "./rss/refreshFeed.js";
import { openThread, startThreadResponseGeneration } from "./threads/openThread.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

loadEnv();

const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;

if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
}

function createMainWindow(): void {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 600,
    title: appInfo.name,
    backgroundColor: "#efeffc",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
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
ipcMain.handle("threads:list", (_event, feedId: string) => listThreads(feedId));
ipcMain.handle("threads:get", (_event, threadId: string) => {
  const thread = openThread(threadId);
  return thread;
});
ipcMain.handle("threads:generate", (event, threadId: string, force: boolean) => {
  startThreadResponseGeneration(threadId, force, (status) => {
    event.sender.send("threads:generation-complete", { threadId, status });
  });
});
ipcMain.handle("feeds:refresh", async (event, feedId: string) =>
  refreshFeed(feedId, (message) => {
    event.sender.send("feeds:refresh-progress", { feedId, message });
  })
);
ipcMain.handle("stats:get", () => getStatistics());
ipcMain.handle("feeds:get-resident-prompt", (_event, feedId: string) => getFeedResidentPrompt(feedId));
ipcMain.handle("feeds:save-resident-prompt", (_event, feedId: string, prompt: string) => saveFeedResidentPrompt(feedId, prompt));
ipcMain.handle("feeds:clear-resident-prompt", (_event, feedId: string) => clearFeedResidentPrompt(feedId));
ipcMain.handle("settings:get", (_event, key: string) => getUserSetting(key));
ipcMain.handle("settings:save", (_event, key: string, value: string) => saveUserSetting(key, value));
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
