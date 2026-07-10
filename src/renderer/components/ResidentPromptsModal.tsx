import type { FeedSource, ResidentPromptVersion } from "../../shared/types";

type ResidentPromptsModalProps = {
  feeds: FeedSource[];
  promptTargetFeedId: string;
  promptText: string;
  isPromptLoading: boolean;
  promptStatusMessage: string;
  promptVersions: ResidentPromptVersion[];
  onPromptTargetFeedIdChange: (feedId: string) => void;
  onPromptTextChange: (text: string) => void;
  onSavePrompt: () => void;
  onClearPrompt: () => void;
  onReviewPromptVersion: (id: string, decision: "active" | "rejected") => void;
  onRollbackPromptVersion: () => void;
  onClose: () => void;
};

export function ResidentPromptsModal({
  feeds,
  promptTargetFeedId,
  promptText,
  isPromptLoading,
  promptStatusMessage,
  promptVersions,
  onPromptTargetFeedIdChange,
  onPromptTextChange,
  onSavePrompt,
  onClearPrompt,
  onReviewPromptVersion,
  onRollbackPromptVersion,
  onClose
}: ResidentPromptsModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="resident-prompts-modal" aria-label="住民設定" role="dialog">
        <div className="modal-title-bar">
          <span>住民設定（板ごとのカスタムプロンプト）</span>
          <button className="modal-close-button" onClick={onClose} type="button">
            x
          </button>
        </div>
        <div className="modal-content">
          <div className="form-group">
            <label htmlFor="prompt-feed-select">対象の板:</label>
            <select
              id="prompt-feed-select"
              value={promptTargetFeedId}
              onChange={(event) => onPromptTargetFeedIdChange(event.target.value)}
              className="feed-select"
              disabled={isPromptLoading}
            >
              {feeds.map((feed) => (
                <option key={feed.id} value={feed.id}>
                  {feed.title}
                </option>
              ))}
            </select>
          </div>

          <div className="prompt-versions">
            <div className="prompt-versions-title">自動改善（gemini-3.5-flash）</div>
            {promptVersions.length === 0 ? <div className="prompt-version-empty">まだ改善履歴はありません。レス評価が5件たまると改善案を作成します。</div> : null}
            {promptVersions.filter((version) => version.status === "pending" || version.status === "active").map((version) => (
              <section className={`prompt-version is-${version.status}`} key={version.id}>
                <div className="prompt-version-heading">{version.status === "pending" ? "確認待ちの改善案" : "適用中の改善ルール"}</div>
                {version.status === "pending" ? (
                  <>
                    <div className="prompt-version-label">変更前</div>
                    <pre>{promptVersions.find((candidate) => candidate.id === version.parentId)?.adaptivePrompt ?? "（自動改善なし）"}</pre>
                    <div className="prompt-version-label">変更後</div>
                  </>
                ) : null}
                <pre>{version.adaptivePrompt}</pre>
                <div className="prompt-version-rationale">理由: {version.rationale}</div>
                {version.changes.length ? <ul>{version.changes.map((change) => <li key={change}>{change}</li>)}</ul> : null}
                {version.status === "pending" ? (
                  <div className="prompt-version-actions">
                    <button className="btn" disabled={isPromptLoading} onClick={() => onReviewPromptVersion(version.id, "active")} type="button">採用</button>
                    <button className="btn" disabled={isPromptLoading} onClick={() => onReviewPromptVersion(version.id, "rejected")} type="button">却下</button>
                  </div>
                ) : null}
              </section>
            ))}
            {promptVersions.some((version) => version.status === "archived") ? (
              <button className="btn" disabled={isPromptLoading} onClick={onRollbackPromptVersion} type="button">一つ前の改善版に戻す</button>
            ) : null}
          </div>

          <div className="form-group flex-grow">
            <label htmlFor="prompt-text-textarea">住民プロンプト（スレのレス生成時のカスタム指示）:</label>
            <textarea
              id="prompt-text-textarea"
              value={promptText}
              onChange={(event) => onPromptTextChange(event.target.value)}
              placeholder="例：このスレの住民はメンバー愛に溢れ、ヌクモリティが高く、お互いを肯定しあうほのぼのした雰囲気です。叩きや煽りは禁止。"
              className="prompt-textarea"
              disabled={isPromptLoading}
            />
          </div>

          {promptStatusMessage ? (
            <div className="prompt-status-message">
              {promptStatusMessage}
            </div>
          ) : null}

          <div className="modal-buttons">
            <button
              onClick={onSavePrompt}
              className="btn"
              disabled={isPromptLoading || !promptTargetFeedId}
              type="button"
            >
              保存
            </button>
            <button
              onClick={onClearPrompt}
              className="btn"
              disabled={isPromptLoading || !promptTargetFeedId}
              type="button"
            >
              デフォルトに戻す
            </button>
            <button
              onClick={onClose}
              className="btn"
              type="button"
            >
              閉じる
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
