import type { ThreadGenerationAttempt, ThreadListItem } from "../../shared/types";

type GenerationFailureModalProps = {
  thread: ThreadListItem | undefined;
  attempts: ThreadGenerationAttempt[];
  isLoading: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  onClose: () => void;
};

const stageLabels: Record<ThreadGenerationAttempt["stage"], string> = {
  "checking-cache": "記事キャッシュの確認",
  "fetching-article": "元記事の取得",
  "preparing-context": "AI向けコンテキストの準備",
  "generating-posts": "Geminiによるレス生成",
  "saving-posts": "生成レスの保存"
};

export function GenerationFailureModal({
  thread,
  attempts,
  isLoading,
  isRetrying,
  onRetry,
  onClose
}: GenerationFailureModalProps) {
  const latestFailure = attempts.find((attempt) => attempt.status === "failed");

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="generation-failure-modal" aria-label="生成失敗の詳細" role="dialog">
        <div className="modal-title-bar">
          <span>生成失敗の詳細</span>
          <button className="modal-close-button" onClick={onClose} type="button">x</button>
        </div>
        <div className="generation-failure-content">
          <div className="generation-failure-thread-title">{thread?.vipTitle ?? "スレッド"}</div>
          {isLoading ? (
            <div className="stats-loading">履歴を読み込み中...</div>
          ) : latestFailure ? (
            <>
              <dl className="generation-failure-summary">
                <dt>失敗箇所</dt>
                <dd>{stageLabels[latestFailure.stage]}</dd>
                <dt>内容</dt>
                <dd className="text-error">{latestFailure.errorMessage ?? "詳細不明のエラーです。"}</dd>
                <dt>日時</dt>
                <dd>{formatAttemptDate(latestFailure.finishedAt ?? latestFailure.startedAt)}</dd>
                <dt>モデル</dt>
                <dd>{latestFailure.model}</dd>
              </dl>
              {latestFailure.technicalDetails ? (
                <details className="generation-technical-details">
                  <summary>技術詳細</summary>
                  <pre>{latestFailure.technicalDetails}</pre>
                </details>
              ) : null}
              <div className="generation-attempt-history">
                <div className="stats-section-title">直近の生成履歴</div>
                {attempts.map((attempt) => (
                  <div className={`generation-attempt-row is-${attempt.status}`} key={attempt.id}>
                    <span>{formatAttemptDate(attempt.finishedAt ?? attempt.startedAt)}</span>
                    <span>{formatAttemptStatus(attempt.status)}</span>
                    <span>{stageLabels[attempt.stage]}</span>
                    <span>{attempt.errorMessage ?? ""}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="generation-failure-empty">保存された失敗履歴がありません。</div>
          )}
        </div>
        <div className="generation-failure-actions">
          <button disabled={isLoading || isRetrying || !thread} onClick={onRetry} type="button">
            {isRetrying ? "再生成を開始中..." : "再生成"}
          </button>
          <button onClick={onClose} type="button">閉じる</button>
        </div>
      </section>
    </div>
  );
}

function formatAttemptDate(value: string): string {
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

function formatAttemptStatus(status: ThreadGenerationAttempt["status"]): string {
  if (status === "completed") return "成功";
  if (status === "failed") return "失敗";
  if (status === "skipped") return "スキップ";
  return "実行中";
}
