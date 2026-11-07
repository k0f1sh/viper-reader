import { useState } from "react";
import { normalizeDomain, type BrowserDomains } from "../../shared/browserDomains";
type BrowserSettingsModalProps = {
  domains: BrowserDomains;
  onDomainsChange: (value: BrowserDomains) => void;
  blockingEnabled: boolean;
  isSaving: boolean;
  statusMessage: string;
  onBlockingEnabledChange: (enabled: boolean) => void;
  onClose: () => void;
};

export function BrowserSettingsModal({
  domains, onDomainsChange,
  blockingEnabled,
  isSaving,
  statusMessage,
  onBlockingEnabledChange,
  onClose
}: BrowserSettingsModalProps) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
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
            <legend>サイト別の初期表示</legend>
            <label><input type="checkbox" checked={domains.enabled} onChange={e => onDomainsChange({ ...domains, enabled: e.target.checked })} />指定サイトを最初から内蔵ブラウザで開く</label>
            <p>サブドメインも対象になります。</p>
            <input aria-label="対象ドメイン" placeholder="togetter.com" value={input} onChange={e => setInput(e.target.value)} />
            <button onClick={() => { try { const d = normalizeDomain(input); onDomainsChange({ ...domains, domains: [...new Set([...domains.domains, d])] }); setInput(""); setError(""); } catch (e) { setError(String(e)); } }}>追加</button>
            {domains.domains.map(d => <div key={d}>{d} <button onClick={() => onDomainsChange({ ...domains, domains: domains.domains.filter(v => v !== d) })}>削除</button></div>)}
            {error && <p role="alert">{error}</p>}
          </fieldset>
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
