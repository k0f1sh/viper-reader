import type { FeedSource } from "../../shared/types";

type FeedSettingsModalProps = {
  feed: FeedSource;
  generateTitleFromSummary: boolean;
  isSaving: boolean;
  error: string;
  onGenerateTitleFromSummaryChange: (enabled: boolean) => void;
  onSave: () => void;
  onClose: () => void;
};

export function FeedSettingsModal({
  feed,
  generateTitleFromSummary,
  isSaving,
  error,
  onGenerateTitleFromSummaryChange,
  onSave,
  onClose
}: FeedSettingsModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="add-feed-modal" aria-label="板の設定" role="dialog">
        <div className="modal-title-bar">
          <span>板の設定</span>
          <button className="modal-close-button" disabled={isSaving} onClick={onClose} type="button">x</button>
        </div>
        <div className="modal-content">
          <div className="feed-settings-title">{feed.title}</div>
          <label className="add-feed-checkbox">
            <input
              type="checkbox"
              checked={generateTitleFromSummary}
              disabled={isSaving}
              onChange={(event) => onGenerateTitleFromSummaryChange(event.target.checked)}
            />
            <span>タイトルではなく本文からスレタイ生成</span>
          </label>
          <div className="add-feed-checkbox-help">
            RSSに含まれる description / summary を使います。変更は未生成の記事から適用されます。
          </div>
          {error ? <div className="prompt-status-message text-error">{error}</div> : null}
          <div className="modal-buttons">
            <button className="btn" disabled={isSaving} onClick={onSave} type="button">保存</button>
            <button className="btn" disabled={isSaving} onClick={onClose} type="button">キャンセル</button>
          </div>
        </div>
      </section>
    </div>
  );
}
