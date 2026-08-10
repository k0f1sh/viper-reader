import type { FeedSource } from "../../shared/types";

type FeedSettingsModalProps = {
  feed: FeedSource;
  title: string;
  generateTitleFromSummary: boolean;
  skipTitleConversion: boolean;
  isSaving: boolean;
  error: string;
  onTitleChange: (title: string) => void;
  onGenerateTitleFromSummaryChange: (enabled: boolean) => void;
  onSkipTitleConversionChange: (enabled: boolean) => void;
  onSave: () => void;
  onClose: () => void;
};

export function FeedSettingsModal({
  feed,
  title,
  generateTitleFromSummary,
  skipTitleConversion,
  isSaving,
  error,
  onTitleChange,
  onGenerateTitleFromSummaryChange,
  onSkipTitleConversionChange,
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
          <label htmlFor="feed-settings-title">板タイトル:</label>
          <input
            id="feed-settings-title"
            className="add-feed-input"
            type="text"
            value={title}
            maxLength={200}
            disabled={isSaving}
            onChange={(event) => onTitleChange(event.target.value)}
          />
          <div className="add-feed-checkbox-help">RSS URL: {feed.url}</div>
          <label className="add-feed-checkbox">
            <input
              type="checkbox"
              checked={skipTitleConversion}
              disabled={isSaving}
              onChange={(event) => onSkipTitleConversionChange(event.target.checked)}
            />
            <span>スレタイ変換しない</span>
          </label>
          <div className="add-feed-checkbox-help">
            Geminiによる変換を行わず、RSSの元タイトルをそのまま表示します。
          </div>
          <label className="add-feed-checkbox">
            <input
              type="checkbox"
              checked={generateTitleFromSummary}
              disabled={isSaving || skipTitleConversion}
              onChange={(event) => onGenerateTitleFromSummaryChange(event.target.checked)}
            />
            <span>タイトルではなく本文からスレタイ生成</span>
          </label>
          <div className="add-feed-checkbox-help">
            RSSに含まれる description / summary を使います。変更は未生成の記事から適用されます。
          </div>
          {error ? <div className="prompt-status-message text-error">{error}</div> : null}
          <div className="modal-buttons">
            <button className="btn" disabled={isSaving || !title.trim()} onClick={onSave} type="button">保存</button>
            <button className="btn" disabled={isSaving} onClick={onClose} type="button">キャンセル</button>
          </div>
        </div>
      </section>
    </div>
  );
}
