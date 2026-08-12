import { useEffect, useState } from "react";
import type { FeedSource, GeminiApiKeyStatus, StatisticsSummary } from "../../shared/types";

type UseAppSettingsOptions = {
  feeds: FeedSource[];
  selectedFeedId: string;
  reloadFeeds: () => Promise<void>;
};

export function useAppSettings({ feeds, selectedFeedId, reloadFeeds }: UseAppSettingsOptions) {
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [statisticsLoading, setStatisticsLoading] = useState(false);
  const [statistics, setStatistics] = useState<StatisticsSummary | null>(null);
  const [apiSettingsOpen, setApiSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState<GeminiApiKeyStatus | null>(null);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [apiKeyMessage, setApiKeyMessage] = useState("");
  const [browserSettingsOpen, setBrowserSettingsOpen] = useState(false);
  const [browserBlockingEnabled, setBrowserBlockingEnabled] = useState(true);
  const [browserSettingsSaving, setBrowserSettingsSaving] = useState(false);
  const [browserSettingsMessage, setBrowserSettingsMessage] = useState("");
  const [modelSettingsOpen, setModelSettingsOpen] = useState(false);
  const [modelSettingsSaving, setModelSettingsSaving] = useState(false);
  const [replyModel, setReplyModel] = useState("gemini-3.6-flash");
  const [titleModel, setTitleModel] = useState("gemini-3.5-flash-lite");
  const [promptsOpen, setPromptsOpen] = useState(false);
  const [promptFeedId, setPromptFeedId] = useState("");
  const [promptText, setPromptText] = useState("");
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptMessage, setPromptMessage] = useState("");

  useEffect(() => {
    if (!window.viperReader) return;
    void Promise.all([
      window.viperReader.getUserSetting("replyModel"),
      window.viperReader.getUserSetting("titleModel"),
      window.viperReader.getUserSetting("articleBrowserBlockingEnabled")
    ]).then(([savedReplyModel, savedTitleModel, savedBlocking]) => {
      if (savedReplyModel) setReplyModel(savedReplyModel);
      if (savedTitleModel) setTitleModel(savedTitleModel);
      setBrowserBlockingEnabled(savedBlocking !== "false");
    }).catch((error) => console.error("ユーザー設定の読込に失敗しました:", error));
  }, []);

  useEffect(() => {
    if (!promptsOpen || !promptFeedId || !window.viperReader) return;
    setPromptLoading(true);
    setPromptMessage("");
    void window.viperReader.getFeedResidentPrompt(promptFeedId).then((result) => {
      setPromptText(result?.prompt ?? "");
    }).catch((error) => {
      setPromptMessage(error instanceof Error ? `読込失敗: ${error.message}` : "読込失敗");
    }).finally(() => setPromptLoading(false));
  }, [promptsOpen, promptFeedId]);

  async function openStatistics() {
    setStatisticsOpen(true);
    if (!window.viperReader) {
      setStatistics(null);
      return;
    }
    setStatisticsLoading(true);
    try {
      setStatistics(await window.viperReader.getStatistics());
    } finally {
      setStatisticsLoading(false);
    }
  }

  async function openApiSettings() {
    setApiSettingsOpen(true);
    setApiKey("");
    setApiKeyMessage("");
    if (!window.viperReader) {
      setApiKeyStatus(null);
      return;
    }
    try {
      setApiKeyStatus(await window.viperReader.getGeminiApiKeyStatus());
    } catch (error) {
      setApiKeyMessage(error instanceof Error ? error.message : "API キー設定の読込に失敗しました。");
    }
  }

  async function saveApiKey() {
    if (!window.viperReader || !apiKey.trim()) return;
    setApiKeySaving(true);
    setApiKeyMessage("");
    try {
      setApiKeyStatus(await window.viperReader.saveGeminiApiKey(apiKey));
      setApiKey("");
      setApiKeyMessage("API キーをローカル設定へ保存しました。");
    } catch (error) {
      setApiKeyMessage(error instanceof Error ? error.message : "API キーの保存に失敗しました。");
    } finally {
      setApiKeySaving(false);
    }
  }

  async function clearApiKey() {
    if (!window.viperReader) return;
    setApiKeySaving(true);
    setApiKeyMessage("");
    try {
      const status = await window.viperReader.clearGeminiApiKey();
      setApiKeyStatus(status);
      setApiKey("");
      setApiKeyMessage(status.source === "environment"
        ? "ローカル設定のキーを削除しました。環境変数のキーへ切り替わりました。"
        : "保存済みの API キーを削除しました。");
    } catch (error) {
      setApiKeyMessage(error instanceof Error ? error.message : "API キーの削除に失敗しました。");
    } finally {
      setApiKeySaving(false);
    }
  }

  async function saveModels(models: { titleModel: string; replyModel: string }) {
    if (!window.viperReader) return;
    setModelSettingsSaving(true);
    try {
      await Promise.all([
        window.viperReader.saveUserSetting("titleModel", models.titleModel),
        window.viperReader.saveUserSetting("replyModel", models.replyModel)
      ]);
      setTitleModel(models.titleModel);
      setReplyModel(models.replyModel);
      setModelSettingsOpen(false);
    } catch (error) {
      console.error("モデル設定の保存に失敗しました:", error);
    } finally {
      setModelSettingsSaving(false);
    }
  }

  async function setBrowserBlocking(enabled: boolean) {
    if (!window.viperReader) return;
    setBrowserSettingsSaving(true);
    setBrowserSettingsMessage("");
    try {
      await window.viperReader.setArticleBrowserGlobalBlockingEnabled(enabled);
      setBrowserBlockingEnabled(enabled);
      setBrowserSettingsMessage(enabled ? "広告・追跡ブロックを有効にしました。" : "広告・追跡ブロックを無効にしました。");
    } catch (error) {
      setBrowserSettingsMessage(error instanceof Error ? error.message : "ブラウザ設定の保存に失敗しました。");
    } finally {
      setBrowserSettingsSaving(false);
    }
  }

  function openBrowserSettings() {
    setBrowserSettingsMessage("");
    setBrowserSettingsOpen(true);
  }

  function openPrompts() {
    setPromptsOpen(true);
    setPromptFeedId(selectedFeedId || feeds[0]?.id || "");
    setPromptMessage("");
  }

  async function savePrompt() {
    if (!window.viperReader || !promptFeedId || promptLoading) return;
    setPromptLoading(true);
    setPromptMessage("");
    try {
      if (promptText.trim()) {
        await window.viperReader.saveFeedResidentPrompt(promptFeedId, promptText);
        setPromptMessage("保存しました");
      } else {
        await window.viperReader.clearFeedResidentPrompt(promptFeedId);
        setPromptMessage("クリアしました（デフォルトに戻りました）");
      }
      await reloadFeeds();
    } catch (error) {
      setPromptMessage(error instanceof Error ? `保存失敗: ${error.message}` : "保存失敗");
    } finally {
      setPromptLoading(false);
    }
  }

  async function clearPrompt() {
    if (!window.viperReader || !promptFeedId || promptLoading) return;
    setPromptLoading(true);
    setPromptMessage("");
    try {
      await window.viperReader.clearFeedResidentPrompt(promptFeedId);
      setPromptText("");
      setPromptMessage("クリアしました（デフォルトに戻りました）");
      await reloadFeeds();
    } catch (error) {
      setPromptMessage(error instanceof Error ? `クリア失敗: ${error.message}` : "クリア失敗");
    } finally {
      setPromptLoading(false);
    }
  }

  return {
    statistics: { isOpen: statisticsOpen, isLoading: statisticsLoading, value: statistics, open: openStatistics, close: () => setStatisticsOpen(false) },
    api: { isOpen: apiSettingsOpen, key: apiKey, status: apiKeyStatus, isSaving: apiKeySaving, message: apiKeyMessage, setKey: setApiKey, open: openApiSettings, close: () => setApiSettingsOpen(false), save: saveApiKey, clear: clearApiKey },
    browser: { isOpen: browserSettingsOpen, blockingEnabled: browserBlockingEnabled, isSaving: browserSettingsSaving, message: browserSettingsMessage, open: openBrowserSettings, close: () => setBrowserSettingsOpen(false), setBlocking: setBrowserBlocking },
    models: { isOpen: modelSettingsOpen, titleModel, replyModel, isSaving: modelSettingsSaving, open: () => setModelSettingsOpen(true), close: () => setModelSettingsOpen(false), save: saveModels },
    prompts: { isOpen: promptsOpen, feedId: promptFeedId, text: promptText, isLoading: promptLoading, message: promptMessage, setFeedId: setPromptFeedId, setText: setPromptText, open: openPrompts, close: () => setPromptsOpen(false), save: savePrompt, clear: clearPrompt }
  };
}
