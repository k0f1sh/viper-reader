type AddFeedModalProps = {
  addFeedTitle: string;
  addFeedUrl: string;
  addFeedError: string;
  generateTitleFromSummary: boolean;
  isAddFeedLoading: boolean;
  onTitleChange: (title: string) => void;
  onUrlChange: (url: string) => void;
  onGenerateTitleFromSummaryChange: (enabled: boolean) => void;
  onAddFeed: () => void;
  onClose: () => void;
};

export function AddFeedModal({
  addFeedTitle,
  addFeedUrl,
  addFeedError,
  generateTitleFromSummary,
  isAddFeedLoading,
  onTitleChange,
  onUrlChange,
  onGenerateTitleFromSummaryChange,
  onAddFeed,
  onClose
}: AddFeedModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="add-feed-modal" aria-label="板を追加する" role="dialog">
        <div className="modal-title-bar">
          <span>板の追加（RSSの登録）</span>
          <button className="modal-close-button" onClick={onClose} type="button">
            x
          </button>
        </div>
        <div className="modal-content">
          <div className="form-group">
            <label htmlFor="add-feed-title-input">板の名前（タイトル）:</label>
            <input
              id="add-feed-title-input"
              type="text"
              value={addFeedTitle}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="例：はてなブックマークIT"
              className="form-input"
              disabled={isAddFeedLoading}
            />
          </div>
          <div className="form-group">
            <label htmlFor="add-feed-url-input">RSS フィード URL:</label>
            <input
              id="add-feed-url-input"
              type="text"
              value={addFeedUrl}
              onChange={(event) => onUrlChange(event.target.value)}
              placeholder="例：https://b.hatena.ne.jp/hotentry/it.rss"
              className="form-input"
              disabled={isAddFeedLoading}
            />
          </div>
          <label className="add-feed-checkbox">
            <input
              type="checkbox"
              checked={generateTitleFromSummary}
              disabled={isAddFeedLoading}
              onChange={(event) => onGenerateTitleFromSummaryChange(event.target.checked)}
            />
            <span>タイトルではなく本文からスレタイ生成</span>
          </label>
          <div className="add-feed-checkbox-help">
            RSSに含まれる description / summary を使います（記事ページは取得しません）。
          </div>

          {addFeedError ? (
            <div className="prompt-status-message text-error" style={{ color: "#ff0000", marginTop: "8px" }}>
              {addFeedError}
            </div>
          ) : null}

          <div className="modal-buttons">
            <button
              onClick={onAddFeed}
              className="btn"
              disabled={isAddFeedLoading || !addFeedTitle.trim() || !addFeedUrl.trim()}
              type="button"
            >
              追加
            </button>
            <button
              onClick={onClose}
              className="btn"
              disabled={isAddFeedLoading}
              type="button"
            >
              キャンセル
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
