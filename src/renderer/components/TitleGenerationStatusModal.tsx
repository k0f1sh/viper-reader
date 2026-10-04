import type { ThreadListItem, TitleGenerationAttempt } from "../../shared/types";

type Props = {
  thread: ThreadListItem | undefined;
  attempts: TitleGenerationAttempt[];
  isLoading: boolean;
  onClose: () => void;
};

export function TitleGenerationStatusModal({ thread, attempts, isLoading, onClose }: Props) {
  const latest = attempts[0];
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="title-generation-status-modal" aria-label="スレタイ変換の詳細" role="dialog">
        <div className="modal-title-bar">
          <span>スレタイ変換の詳細</span>
          <button className="modal-close-button" onClick={onClose} type="button">x</button>
        </div>
        <div className="generation-failure-content">
          <div className="generation-failure-thread-title">{thread?.originalTitle ?? "スレッド"}</div>
          {isLoading ? (
            <div className="stats-loading">履歴を読み込み中...</div>
          ) : latest ? (
            <>
              <dl className="generation-failure-summary">
                <dt>状態</dt>
                <dd>{latest.status === "failed" ? "変換失敗" : latest.status === "skipped" ? "未変換" : "変換成功"}</dd>
                <dt>内容</dt>
                <dd className={latest.status === "failed" ? "text-error" : ""}>
                  {latest.errorMessage ?? "正常に変換されました。"}
                </dd>
                <dt>日時</dt>
                <dd>{formatDate(latest.attemptedAt)}</dd>
                <dt>モデル</dt>
                <dd>{latest.model}</dd>
              </dl>
              <div className="generation-attempt-history">
                <div className="stats-section-title">直近の変換履歴</div>
                {attempts.map((attempt) => (
                  <div className={`title-generation-attempt-row is-${attempt.status}`} key={attempt.id}>
                    <span>{formatDate(attempt.attemptedAt)}</span>
                    <span>{attempt.status === "completed" ? "成功" : attempt.status === "failed" ? "失敗" : "未変換"}</span>
                    <span>{attempt.model}</span>
                    <span>{attempt.errorMessage ?? ""}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="generation-failure-empty">保存された変換履歴がありません。</div>
          )}
        </div>
        <div className="generation-failure-actions">
          <button onClick={onClose} type="button">閉じる</button>
        </div>
      </section>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}
