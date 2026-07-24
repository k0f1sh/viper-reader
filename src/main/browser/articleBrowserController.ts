import { BrowserWindow, Menu, WebContentsView, shell } from "electron";
import type { Rectangle, Session } from "electron";
import type {
  ArticleBrowserBounds,
  ArticleBrowserState,
  ShowArticleBrowserRequest
} from "../../shared/types.js";
import { ArticleBlocker } from "./articleBlocker.js";

const emptyState: ArticleBrowserState = {
  threadId: null,
  url: "",
  title: "",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  blockerStatus: "initializing",
  error: null
};

export class ArticleBrowserController {
  private view: WebContentsView | null = null;
  private state: ArticleBrowserState;
  private pendingRequest: ShowArticleBrowserRequest | null = null;
  private isVisible = false;
  private resetHistoryAfterLoad = false;
  private loadedThreadId: string | null = null;

  constructor(
    private readonly owner: BrowserWindow,
    private readonly articleSession: Session,
    private readonly blocker: ArticleBlocker
  ) {
    this.state = { ...emptyState, blockerStatus: blocker.getStatus() };
    blocker.on("status-changed", () => {
      this.state = { ...this.state, blockerStatus: this.resolveBlockerStatus(this.state.url) };
      this.sendState();
      if (blocker.isReady() && this.pendingRequest?.threadId === this.state.threadId) {
        const request = this.pendingRequest;
        this.pendingRequest = null;
        void this.load(request);
      }
    });
  }

  ownsSender(senderId: number): boolean {
    return this.owner.webContents.id === senderId;
  }

  show(request: ShowArticleBrowserRequest): ArticleBrowserState {
    const bounds = clampBounds(request.bounds, this.owner.getContentBounds());
    const safeUrl = parseInternalArticleUrl(request.url);
    const isSameThread = this.state.threadId === request.threadId;
    this.isVisible = true;
    this.state = {
      ...this.state,
      threadId: request.threadId,
      url: isSameThread && this.view?.webContents.getURL()
        ? this.view.webContents.getURL()
        : safeUrl?.toString() ?? request.url,
      title: isSameThread ? this.state.title : "",
      error: safeUrl ? null : "HTTP または未対応のURLはアプリ内で表示できません。",
      blockerStatus: this.resolveBlockerStatus(request.url)
    };

    if (!safeUrl) {
      this.pendingRequest = null;
      this.hideNativeView();
      this.sendState();
      return this.state;
    }

    if (isSameThread && this.view?.webContents.getURL()) {
      this.pendingRequest = null;
      this.view.setBounds(bounds);
      this.blocker.syncForUrl(this.view.webContents.getURL());
      this.state = {
        ...this.state,
        blockerStatus: this.resolveBlockerStatus(this.view.webContents.getURL())
      };
      this.showNativeView();
      this.sendState();
      return this.state;
    }

    if (!this.blocker.isReady() && !request.allowUnprotected) {
      this.pendingRequest = { ...request, url: safeUrl.toString(), bounds };
      this.hideNativeView();
      this.state = {
        ...this.state,
        error: this.blocker.getStatus() === "unavailable"
          ? "広告・追跡フィルターを準備できませんでした。"
          : null
      };
      this.sendState();
      return this.state;
    }

    this.pendingRequest = null;
    void this.load({ ...request, url: safeUrl.toString(), bounds });
    return this.state;
  }

  hide(): void {
    this.isVisible = false;
    this.hideNativeView();
  }

  setBounds(bounds: ArticleBrowserBounds): void {
    if (!this.view) {
      return;
    }
    this.view.setBounds(clampBounds(bounds, this.owner.getContentBounds()));
  }

  goBack(): void {
    if (this.view?.webContents.navigationHistory.canGoBack()) {
      this.view.webContents.navigationHistory.goBack();
    }
  }

  goForward(): void {
    if (this.view?.webContents.navigationHistory.canGoForward()) {
      this.view.webContents.navigationHistory.goForward();
    }
  }

  reload(): void {
    this.view?.webContents.reload();
  }

  scroll(direction: -1 | 1): void {
    if (!this.view || !this.isVisible) {
      return;
    }
    const multiplier = direction < 0 ? -1 : 1;
    void this.view.webContents.executeJavaScript(
      `window.scrollBy({ top: ${multiplier} * Math.max(80, Math.round(window.innerHeight / 3)), behavior: "smooth" });`
    );
  }

  async openExternal(): Promise<void> {
    const safeUrl = parseExternalWebUrl(this.state.url);
    if (!safeUrl) {
      throw new Error("外部ブラウザで開けるURLがありません。");
    }
    await shell.openExternal(safeUrl.toString());
  }

  setBlockingEnabled(enabled: boolean): ArticleBrowserState {
    if (!this.state.url || !this.blocker.isReady() || !this.blocker.isGloballyEnabled()) {
      return this.state;
    }
    this.blocker.setDisabledFor(this.state.url, !enabled);
    this.state = { ...this.state, blockerStatus: this.resolveBlockerStatus(this.state.url) };
    this.view?.webContents.reload();
    this.sendState();
    return this.state;
  }

  setGlobalBlockingEnabled(enabled: boolean): ArticleBrowserState {
    this.blocker.setGloballyEnabled(enabled, this.state.url);
    this.state = { ...this.state, blockerStatus: this.resolveBlockerStatus(this.state.url) };
    this.view?.webContents.reload();
    this.sendState();
    return this.state;
  }

  async retryBlocker(): Promise<ArticleBrowserState> {
    await this.blocker.initialize(true);
    this.state = { ...this.state, blockerStatus: this.resolveBlockerStatus(this.state.url) };
    this.sendState();
    return this.state;
  }

  getState(): ArticleBrowserState {
    return this.state;
  }

  destroy(): void {
    if (!this.view) {
      return;
    }
    this.owner.contentView.removeChildView(this.view);
    this.view.webContents.close();
    this.view = null;
  }

  private async load(request: ShowArticleBrowserRequest): Promise<void> {
    const view = this.ensureView();
    view.setBounds(clampBounds(request.bounds, this.owner.getContentBounds()));
    this.blocker.syncForUrl(request.url);

    const isNewThread = this.loadedThreadId !== request.threadId;
    this.loadedThreadId = request.threadId;
    this.state = {
      ...this.state,
      threadId: request.threadId,
      url: request.url,
      title: "",
      isLoading: true,
      blockerStatus: this.resolveBlockerStatus(request.url),
      error: null
    };
    this.resetHistoryAfterLoad = isNewThread;
    this.showNativeView();
    this.sendState();

    try {
      await view.webContents.loadURL(request.url);
    } catch (error) {
      if (this.state.threadId !== request.threadId) {
        return;
      }
      this.state = {
        ...this.state,
        isLoading: false,
        error: error instanceof Error ? error.message : "記事を読み込めませんでした。"
      };
      this.hideNativeView();
      this.sendState();
    }
  }

  private ensureView(): WebContentsView {
    if (this.view) {
      return this.view;
    }

    const view = new WebContentsView({
      webPreferences: {
        session: this.articleSession,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        autoplayPolicy: "document-user-activation-required",
        spellcheck: false
      }
    });
    view.setBackgroundColor("#ffffff");
    view.setVisible(false);
    this.owner.contentView.addChildView(view);
    this.view = view;

    const contents = view.webContents;
    contents.on("before-input-event", (event, input) => {
      const key = input.key.toLowerCase();
      const hasNoModifiers =
        !input.control
        && !input.meta
        && !input.alt
        && !input.shift;
      const isPlainKeyDown =
        input.type === "keyDown"
        && !input.isAutoRepeat
        && hasNoModifiers;
      if (input.type === "keyDown" && hasNoModifiers && (key === "j" || key === "k")) {
        event.preventDefault();
        this.owner.webContents.focus();
        const keyCode = key === "j" ? "J" : "K";
        this.owner.webContents.sendInputEvent({ type: "keyDown", keyCode });
        this.owner.webContents.sendInputEvent({ type: "keyUp", keyCode });
        return;
      }
      if (isPlainKeyDown && (key === "n" || key === "p")) {
        event.preventDefault();
        this.scroll(key === "n" ? 1 : -1);
        return;
      }
      if (
        isPlainKeyDown
        && key === "o"
      ) {
        event.preventDefault();
        this.owner.webContents.focus();
        this.owner.webContents.sendInputEvent({ type: "keyDown", keyCode: "O" });
        this.owner.webContents.sendInputEvent({ type: "keyUp", keyCode: "O" });
      }
    });
    contents.setWindowOpenHandler((details) => {
      const safeUrl = parseInternalArticleUrl(details.url);
      if (safeUrl && (details.disposition === "foreground-tab" || details.disposition === "background-tab" || details.disposition === "default")) {
        setImmediate(() => void contents.loadURL(safeUrl.toString()));
      }
      return { action: "deny" };
    });
    contents.on("will-navigate", (event, url) => {
      if (!parseInternalArticleUrl(url)) {
        event.preventDefault();
        this.state = { ...this.state, error: "HTTPS以外のリンクはアプリ内で開けません。" };
        this.sendState();
      }
    });
    contents.on("will-redirect", (event, url) => {
      if (!parseInternalArticleUrl(url)) {
        event.preventDefault();
        this.state = { ...this.state, error: "安全でないリダイレクトを停止しました。" };
        this.hideNativeView();
        this.sendState();
      }
    });
    contents.on("did-start-navigation", (event) => {
      if (!event.isMainFrame) {
        return;
      }
      this.blocker.syncForUrl(event.url);
      this.state = {
        ...this.state,
        url: event.url,
        isLoading: true,
        blockerStatus: this.resolveBlockerStatus(event.url),
        error: null
      };
      this.sendState();
    });
    contents.on("did-navigate", (_event, url) => {
      this.state = { ...this.state, url, blockerStatus: this.resolveBlockerStatus(url) };
      this.sendState();
    });
    contents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        this.state = { ...this.state, url };
        this.sendState();
      }
    });
    contents.on("did-start-loading", () => {
      this.state = { ...this.state, isLoading: true };
      this.sendState();
    });
    contents.on("did-stop-loading", () => {
      if (this.resetHistoryAfterLoad) {
        contents.navigationHistory.clear();
        this.resetHistoryAfterLoad = false;
      }
      this.state = {
        ...this.state,
        isLoading: false,
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward()
      };
      this.sendState();
    });
    contents.on("page-title-updated", (_event, title) => {
      this.state = { ...this.state, title };
      this.sendState();
    });
    contents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) {
        return;
      }
      this.state = { ...this.state, isLoading: false, error: errorDescription };
      this.hideNativeView();
      this.sendState();
    });
    contents.on("context-menu", (_event, params) => {
      const template: Electron.MenuItemConstructorOptions[] = [];
      if (params.selectionText) {
        template.push({ role: "copy", label: "コピー" });
      }
      if (params.linkURL && parseExternalWebUrl(params.linkURL)) {
        template.push({
          label: "リンクを外部ブラウザで開く",
          click: () => void shell.openExternal(params.linkURL)
        });
      }
      if (template.length > 0) {
        Menu.buildFromTemplate(template).popup({ window: this.owner });
      }
    });
    this.articleSession.on("will-download", (event, _item, webContents) => {
      if (webContents.id !== contents.id) {
        return;
      }
      event.preventDefault();
      this.state = { ...this.state, error: "アプリ内ダウンロードは無効です。外部ブラウザを使用してください。" };
      this.sendState();
    });

    return view;
  }

  private showNativeView(): void {
    if (this.view && this.isVisible && !this.state.error) {
      this.view.setVisible(true);
    }
  }

  private hideNativeView(): void {
    this.view?.setVisible(false);
  }

  private resolveBlockerStatus(url: string): ArticleBrowserState["blockerStatus"] {
    if (!this.blocker.isGloballyEnabled()) {
      return "disabled-globally";
    }
    if (!this.blocker.isReady()) {
      return this.blocker.getStatus();
    }
    return this.blocker.isDisabledFor(url) ? "disabled-for-site" : "active";
  }

  private sendState(): void {
    if (!this.owner.isDestroyed()) {
      this.owner.webContents.send("article-browser:state", this.state);
    }
  }
}

function parseInternalArticleUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

function parseExternalWebUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

function clampBounds(bounds: ArticleBrowserBounds, contentBounds: Rectangle): Rectangle {
  const x = clampInteger(bounds.x, 0, contentBounds.width);
  const y = clampInteger(bounds.y, 0, contentBounds.height);
  const width = clampInteger(bounds.width, 0, contentBounds.width - x);
  const height = clampInteger(bounds.height, 0, contentBounds.height - y);
  return { x, y, width, height };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}
