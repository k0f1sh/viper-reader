import { useEffect, useState } from "react";

export function CommandHookSettings({ onSaved }: { onSaved: () => void }) {
  const [command, setCommand] = useState("");
  const [argumentsText, setArgumentsText] = useState("{url}");
  const [busy, setBusy] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    if (!window.viperReader) { setBusy(false); return; }
    void window.viperReader.getCommandHook().then((config) => {
      if (!active) return;
      setCommand(config?.command ?? "");
      setArgumentsText(config ? config.args.join("\n") : "{url}");
      setLoaded(true);
    }).catch(() => {
      if (active) setMessage("フック設定を読み込めません。削除して登録し直してください。");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  async function save(clear: boolean) {
    if (!window.viperReader || busy) return;
    setBusy(true);
    try {
      if (clear) {
        await window.viperReader.clearCommandHook();
        setCommand("");
        setArgumentsText("{url}");
        setLoaded(true);
      } else {
        await window.viperReader.saveCommandHook({
          command: command.trim(),
          args: argumentsText === "" ? [] : argumentsText.split(/\r?\n/)
        });
      }
      setMessage(clear ? "フックを削除しました。" : "フックを保存しました。");
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "フック設定の保存に失敗しました。");
    } finally { setBusy(false); }
  }

  return (
    <fieldset disabled={busy}>
      <legend>外部コマンドフック</legend>
      <label htmlFor="hook-command">実行ファイル</label>
      <input id="hook-command" className="settings-input" value={command} onChange={(event) => setCommand(event.target.value)} spellCheck={false} />
      <label htmlFor="hook-arguments">引数（1行につき1引数）</label>
      <textarea id="hook-arguments" className="settings-input" value={argumentsText} onChange={(event) => setArgumentsText(event.target.value)} rows={3} spellCheck={false} />
      <p className="settings-help">レス表示中にtで実行します。{'{url}'}を元記事URLに置換します。実行ファイルは絶対パス、~/からのパス、またはPATH上の名前を指定できます。シェル構文は使えません。設定はローカルのSQLiteに保存します。</p>
      <div className="settings-buttons">
        <button className="settings-button" type="button" disabled={!loaded || !command.trim()} onClick={() => void save(false)}>フックを保存</button>
        <button className="settings-button" type="button" onClick={() => void save(true)}>フックを削除</button>
      </div>
      {message ? <div className="settings-status-message" role="status">{message}</div> : null}
    </fieldset>
  );
}
