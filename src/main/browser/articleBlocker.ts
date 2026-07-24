import { app } from "electron";
import type { Session } from "electron";
import { ElectronBlocker } from "@ghostery/adblocker-electron";
import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";

export type ArticleBlockerStatus = "initializing" | "active" | "disabled-for-site" | "disabled-globally" | "unavailable";

const filterUrls = [
  "https://easylist.to/easylist/easylist.txt",
  "https://easylist.to/easylist/easyprivacy.txt",
  "https://filters.adtidy.org/extension/ublock/filters/7.txt"
];
const refreshIntervalMs = 7 * 24 * 60 * 60 * 1000;

export class ArticleBlocker extends EventEmitter {
  private readonly cachePath = path.join(app.getPath("userData"), "adblock", "engine.bin");
  private blocker: ElectronBlocker | null = null;
  private initialization: Promise<void> | null = null;
  private status: ArticleBlockerStatus = "initializing";
  private readonly disabledOrigins = new Set<string>();
  private globallyEnabled = true;

  constructor(private readonly articleSession: Session) {
    super();
  }

  initialize(forceRefresh = false): Promise<void> {
    if (this.initialization && !forceRefresh) {
      return this.initialization;
    }

    this.setStatus("initializing");
    this.initialization = this.load(forceRefresh)
      .catch((error) => {
        console.error("記事ブラウザの広告フィルターを初期化できませんでした:", error);
        this.blocker = null;
        this.setStatus("unavailable");
      })
      .finally(() => {
        this.initialization = null;
      });
    return this.initialization;
  }

  getStatus(): ArticleBlockerStatus {
    return this.status;
  }

  isReady(): boolean {
    return this.blocker !== null;
  }

  isGloballyEnabled(): boolean {
    return this.globallyEnabled;
  }

  setGloballyEnabled(enabled: boolean, currentUrl = ""): ArticleBlockerStatus {
    this.globallyEnabled = enabled;
    return this.syncForUrl(currentUrl);
  }

  isDisabledFor(url: string): boolean {
    const origin = getHttpsOrigin(url);
    return origin !== null && this.disabledOrigins.has(origin);
  }

  setDisabledFor(url: string, disabled: boolean): void {
    const origin = getHttpsOrigin(url);
    if (!origin) {
      return;
    }
    if (disabled) {
      this.disabledOrigins.add(origin);
    } else {
      this.disabledOrigins.delete(origin);
    }
    this.syncForUrl(url);
  }

  syncForUrl(url: string): ArticleBlockerStatus {
    if (!this.blocker) {
      return this.status;
    }

    const shouldDisable = !this.globallyEnabled || this.isDisabledFor(url);
    const isEnabled = this.blocker.isBlockingEnabled(this.articleSession);
    if (shouldDisable && isEnabled) {
      this.blocker.disableBlockingInSession(this.articleSession);
    } else if (!shouldDisable && !isEnabled) {
      this.blocker.enableBlockingInSession(this.articleSession);
    }

    const nextStatus = !this.globallyEnabled
      ? "disabled-globally"
      : shouldDisable
        ? "disabled-for-site"
        : "active";
    this.setStatus(nextStatus);
    return nextStatus;
  }

  private async load(forceRefresh: boolean): Promise<void> {
    if (!forceRefresh) {
      const cached = await this.readCache();
      if (cached) {
        this.activate(cached.blocker);
        if (Date.now() - cached.modifiedAt > refreshIntervalMs) {
          void this.refreshCacheForNextLaunch();
        }
        return;
      }
    }

    const blocker = await this.fetchBlocker();
    await this.writeCache(blocker);
    this.activate(blocker);
  }

  private activate(blocker: ElectronBlocker): void {
    if (this.blocker?.isBlockingEnabled(this.articleSession)) {
      this.blocker.disableBlockingInSession(this.articleSession);
    }
    this.blocker = blocker;
    this.syncForUrl("");
  }

  private async readCache(): Promise<{ blocker: ElectronBlocker; modifiedAt: number } | null> {
    try {
      const [serialized, stat] = await Promise.all([
        fs.readFile(this.cachePath),
        fs.stat(this.cachePath)
      ]);
      return {
        blocker: ElectronBlocker.deserialize(serialized),
        modifiedAt: stat.mtimeMs
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn("広告フィルターキャッシュを読み込めませんでした。再取得します:", error);
      }
      return null;
    }
  }

  private async fetchBlocker(): Promise<ElectronBlocker> {
    return ElectronBlocker.fromLists(fetch, filterUrls);
  }

  private async writeCache(blocker: ElectronBlocker): Promise<void> {
    const directory = path.dirname(this.cachePath);
    const temporaryPath = `${this.cachePath}.${process.pid}.tmp`;
    await fs.mkdir(directory, { recursive: true });
    try {
      await fs.writeFile(temporaryPath, blocker.serialize());
      await fs.rename(temporaryPath, this.cachePath);
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private async refreshCacheForNextLaunch(): Promise<void> {
    try {
      const blocker = await this.fetchBlocker();
      await this.writeCache(blocker);
      console.info("記事ブラウザの広告フィルターキャッシュを更新しました。");
    } catch (error) {
      console.warn("広告フィルターのバックグラウンド更新に失敗しました。既存キャッシュを使います:", error);
    }
  }

  private setStatus(status: ArticleBlockerStatus): void {
    if (this.status === status) {
      return;
    }
    this.status = status;
    this.emit("status-changed", status);
  }
}

function getHttpsOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}
