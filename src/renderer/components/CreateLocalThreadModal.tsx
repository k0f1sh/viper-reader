import { useRef, useState } from "react";
import type { CreateLocalThreadRequest, CreateLocalThreadResult } from "../../shared/types";

type Props = {
  onCreated: (result: CreateLocalThreadResult) => void;
  onClose: () => void;
};

export function CreateLocalThreadModal({ onCreated, onClose }: Props) {
  const [mode, setMode] = useState<"text" | "url">("text");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const savingRef = useRef(false);

  async function submit() {
    if (!window.viperReader || savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setError("");
    try {
      const request: CreateLocalThreadRequest = mode === "text"
        ? { mode, title, body } : { mode, title, url: url.trim() };
      onCreated(await window.viperReader.createLocalThread(request));
    } catch (error) {
      setError(error instanceof Error ? error.message : "スレッドを作成できませんでした。");
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="add-feed-modal local-thread-modal" role="dialog" aria-modal="true" aria-labelledby="local-thread-title">
        <div className="modal-title-bar">
          <span id="local-thread-title">自由板にスレ立て</span>
          <button className="modal-close-button" disabled={isSaving} onClick={onClose} type="button" aria-label="閉じる">x</button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <div className="modal-content">
            <div className="form-group">
              <label htmlFor="local-title">スレタイ:</label>
              <input id="local-title" className="form-input" autoFocus required maxLength={200}
                disabled={isSaving} value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className="local-input-modes">
              <label><input type="radio" name="local-mode" checked={mode === "text"} disabled={isSaving} onChange={() => setMode("text")} />本文を直接入力</label>
              <label><input type="radio" name="local-mode" checked={mode === "url"} disabled={isSaving} onChange={() => setMode("url")} />URLを指定</label>
            </div>
            {mode === "text" ? (
              <div className="form-group">
                <label htmlFor="local-body">記事本文:</label>
                <textarea id="local-body" className="form-input local-thread-body" required maxLength={10_000}
                  disabled={isSaving} value={body} onChange={(event) => setBody(event.target.value)} />
              </div>
            ) : (
              <div className="form-group">
                <label htmlFor="local-url">記事URL:</label>
                <input id="local-url" className="form-input" type="url" required maxLength={2048} placeholder="https://..."
                  disabled={isSaving} value={url} onChange={(event) => setUrl(event.target.value)} />
                <div className="add-feed-checkbox-help">記事本文を取得・要約し、AI住民がレス2で内容を説明します。</div>
              </div>
            )}
            <div className="add-feed-checkbox-help">AI住民との会話は、スレ立て後の「返信生成」または書き込みで始まります。</div>
            {error ? <div className="write-error-msg" role="alert">{error}</div> : null}
          </div>
          <div className="local-thread-actions">
            <button type="button" onClick={onClose} disabled={isSaving}>キャンセル</button>
            <button type="submit" disabled={isSaving || !title.trim() || !(mode === "text" ? body.trim() : url.trim())}>
              {isSaving ? mode === "url" ? "記事取得・要約中..." : "保存中..." : "スレを立てる"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
