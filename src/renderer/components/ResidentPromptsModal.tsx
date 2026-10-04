import type { FeedSource } from "../../shared/types";

type ResidentPromptsModalProps = {
  feeds: FeedSource[];
  promptTargetFeedId: string;
  promptText: string;
  isPromptLoading: boolean;
  promptStatusMessage: string;
  onPromptTargetFeedIdChange: (feedId: string) => void;
  onPromptTextChange: (text: string) => void;
  onSavePrompt: () => void;
  onClearPrompt: () => void;
  onClose: () => void;
};

export function ResidentPromptsModal({
  feeds,
  promptTargetFeedId,
  promptText,
  isPromptLoading,
  promptStatusMessage,
  onPromptTargetFeedIdChange,
  onPromptTextChange,
  onSavePrompt,
  onClearPrompt,
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
