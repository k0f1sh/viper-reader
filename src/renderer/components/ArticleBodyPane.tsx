import type { ArticleBodyContent, ThreadDetail } from "../../shared/types";

type ArticleBodyPaneProps = {
  selectedThread: ThreadDetail | null;
  articleBody: ArticleBodyContent | null;
  isLoading: boolean;
  onClose: () => void;
};

export function ArticleBodyPane({ selectedThread, articleBody, isLoading, onClose }: ArticleBodyPaneProps) {
  return (
    <aside className="article-body-pane" aria-label="スクレイピングした記事本文" data-keyboard-pane tabIndex={-1}>
      <div className="pane-title article-body-title">
        <span>記事本文</span>
        <button onClick={onClose} title="記事本文を閉じる" type="button">×</button>
      </div>
      {selectedThread ? (
        <div className="article-body-content">
          <div className="article-body-heading">{selectedThread.originalTitle}</div>
          {isLoading ? (
            <div className="article-body-status">本文キャッシュを確認中...</div>
          ) : articleBody ? (
            <div className="article-body-text">{articleBody.contentText}</div>
          ) : (
            <div className="article-body-status">
              スクレイピング済み本文はありません。レスを生成すると、取得できた本文がここに表示されます。
            </div>
          )}
        </div>
      ) : (
        <div className="article-body-status">記事を選択してください。</div>
      )}
    </aside>
  );
}
