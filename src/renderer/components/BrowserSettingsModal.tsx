type BrowserSettingsModalProps = {
  blockingEnabled: boolean;
  isSaving: boolean;
  statusMessage: string;
  onBlockingEnabledChange: (enabled: boolean) => void;
  onClose: () => void;
};

export function BrowserSettingsModal({
  blockingEnabled,
  isSaving,
  statusMessage,
  onBlockingEnabledChange,
  onClose
}: BrowserSettingsModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="settings-modal" aria-label="ブラウザ設定" role="dialog">
        <div className="modal-title-bar">
          <span>ブラウザ設定</span>
          <button className="modal-close-button" disabled={isSaving} onClick={onClose} type="button">
            x
          </button>
        </div>
        <div className="settings-content">
          <fieldset disabled={isSaving}>
            <legend>広告ブロック</legend>
            <label className="browser-settings-checkbox">
              <input
                checked={blockingEnabled}
                onChange={(event) => onBlockingEnabledChange(event.target.checked)}
                type="checkbox"
              />
              元記事ブラウザで広告・追跡通信をブロックする
            </label>
            <p className="settings-help">
              オフにすると、内蔵ブラウザで開いたサイトの広告やトラッカーへ通信する可能性があります。
              オンの場合でも、元記事画面の盾ボタンからサイトごとに一時解除できます。
            </p>
          </fieldset>

          {statusMessage ? <div className="settings-status-message">{statusMessage}</div> : null}

          <div className="settings-buttons">
            <button className="settings-button" disabled={isSaving} onClick={onClose} type="button">
              閉じる
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
