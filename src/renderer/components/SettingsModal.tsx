import { CommandHookSettings } from "./CommandHookSettings";
import type { FormEvent } from "react";
import type { GeminiApiKeyStatus } from "../../shared/types";

type SettingsModalProps = {
  paneLayout: "stacked" | "horizontal";
  onPaneLayoutChange: (layout: "stacked" | "horizontal") => void;
  layoutError: string;
  isLayoutSaving: boolean;
  apiKey: string;
  apiKeyStatus: GeminiApiKeyStatus | null;
  isSaving: boolean;
  statusMessage: string;
  highlightAiArticles: boolean;
  onApiKeyChange: (apiKey: string) => void;
  onSave: () => void;
  onClear: () => void;
  onHighlightAiArticlesChange: (enabled: boolean) => void;
  onClose: () => void;
  onCommandHookSaved: () => void;
};

export function SettingsModal({
  paneLayout,
  onPaneLayoutChange,
  layoutError,
  isLayoutSaving,
  apiKey,
  apiKeyStatus,
  isSaving,
  statusMessage,
  highlightAiArticles,
  onApiKeyChange,
  onSave,
  onClear,
  onHighlightAiArticlesChange,
  onClose,
  onCommandHookSaved
}: SettingsModalProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave();
  }

  const statusLabel = apiKeyStatus?.source === "settings"
    ? "ローカル設定の API キーを使用中"
    : apiKeyStatus?.source === "environment"
      ? "環境変数の API キーを使用中（ローカル設定で上書きできます）"
      : "API キーは未設定";

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" aria-label="設定" role="dialog">
        <div className="modal-title-bar">
          <span>設定</span>
          <button className="modal-close-button" disabled={isSaving} onClick={onClose} type="button">
            x
          </button>
        </div>
        <form className="settings-content" onSubmit={handleSubmit}>
          <fieldset disabled={isSaving}>
            <legend>Gemini API</legend>
            <div className={`api-key-status is-${apiKeyStatus?.source ?? "none"}`}>
              {statusLabel}
            </div>
            <label htmlFor="gemini-api-key-input">API キー:</label>
            <input
              id="gemini-api-key-input"
              autoComplete="new-password"
              className="settings-input"
              onChange={(event) => onApiKeyChange(event.target.value)}
              placeholder={apiKeyStatus?.configured ? "新しいキーを入力すると更新します" : "Gemini API キーを入力"}
              spellCheck={false}
              type="password"
              value={apiKey}
            />
            <p className="settings-help">
              macOS・Windows では暗号化して保存します。Linux ではローカルの SQLite に平文で保存します。
              共有端末では環境変数の使用を推奨します。保存済みの値は画面へ再表示しません。
            </p>
          </fieldset>

          <fieldset disabled={isSaving}>
            <legend>記事一覧</legend>
            <label className="browser-settings-checkbox">
              <input
                checked={highlightAiArticles}
                onChange={(event) => onHighlightAiArticlesChange(event.target.checked)}
                type="checkbox"
              />
              AI・LLM関連記事を強調表示する
            </label>
            <p className="settings-help">
              AIまたはLLMタグが付いた記事のタグ欄と行頭を強調します。
            </p>
          </fieldset>

          <fieldset disabled={isLayoutSaving}>
            <legend>ペイン配置</legend>
            <label className="browser-settings-checkbox">
              <input type="radio" name="pane-layout" checked={paneLayout === "stacked"} onChange={() => onPaneLayoutChange("stacked")} />
              デフォルト（右側を上下分割）
            </label>
            <label className="browser-settings-checkbox">
              <input type="radio" name="pane-layout" checked={paneLayout === "horizontal"} onChange={() => onPaneLayoutChange("horizontal")} />
              横3列（板一覧・スレ一覧・レス表示）
            </label>
            <p className="settings-help">変更するとすぐに反映・保存されます。</p>
            {layoutError ? <div role="alert" className="settings-status-message">{layoutError}</div> : null}
          </fieldset>

          <CommandHookSettings onSaved={onCommandHookSaved} />

          {statusMessage ? <div className="settings-status-message">{statusMessage}</div> : null}

          <div className="settings-buttons">
            <button className="settings-button" disabled={isSaving || !apiKey.trim()} type="submit">
              {isSaving ? "保存中..." : "保存"}
            </button>
            <button
              className="settings-button"
              disabled={isSaving || apiKeyStatus?.source !== "settings"}
              onClick={onClear}
              type="button"
            >
              保存済みキーを削除
            </button>
            <button className="settings-button" disabled={isSaving} onClick={onClose} type="button">
              閉じる
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
