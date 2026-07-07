import type { StatisticsSummary } from "../../shared/types";
import { formatStatsDate, formatStatus } from "./formatters";

type StatisticsModalProps = {
  statistics: StatisticsSummary | null;
  isLoading: boolean;
  onClose: () => void;
};

export function StatisticsModal({ statistics, isLoading, onClose }: StatisticsModalProps) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="statistics-modal" aria-label="統計情報" role="dialog">
        <div className="modal-title-bar">
          <span>統計情報</span>
          <button className="modal-close-button" onClick={onClose} type="button">
            x
          </button>
        </div>
        <div className="modal-menu-strip">
          <span>API統計</span>
          <span>RSS統計</span>
        </div>
        <div className="statistics-content">
          {isLoading ? (
            <div className="stats-loading">
              <span>読み込み中...</span>
              <span className="progress-blocks" aria-hidden="true" />
            </div>
          ) : statistics ? (
            <>
              <section className="stats-section">
                <div className="stats-section-title">API統計</div>
                <div className="stats-grid">
                  <StatCell label="APIログ" value={statistics.api.totalLogs} />
                  <StatCell label="呼び出し回数" value={statistics.api.requestCount} />
                  <StatCell label="成功" value={statistics.api.successLogs} />
                  <StatCell label="失敗" value={statistics.api.errorLogs} />
                  <StatCell label="スキップ" value={statistics.api.skippedLogs} />
                  <StatCell label="対象件数" value={statistics.api.itemCount} />
                  <StatCell label="Prompt文字" value={statistics.api.promptChars} />
                  <StatCell label="Response文字" value={statistics.api.responseChars} />
                  <StatCell label="Prompt token" value={statistics.api.promptTokenCount} />
                  <StatCell label="Output token" value={statistics.api.candidatesTokenCount} />
                  <StatCell label="Total token" value={statistics.api.totalTokenCount} />
                  <StatCell label="最終実行" value={formatStatsDate(statistics.api.lastFinishedAt)} />
                </div>
              </section>

              <section className="stats-section">
                <div className="stats-section-title">RSS統計</div>
                <div className="stats-grid">
                  <StatCell label="更新回数" value={statistics.rss.totalRuns} />
                  <StatCell label="成功" value={statistics.rss.successRuns} />
                  <StatCell label="失敗" value={statistics.rss.errorRuns} />
                  <StatCell label="取得件数" value={statistics.rss.fetchedCount} />
                  <StatCell label="新規" value={statistics.rss.insertedCount} />
                  <StatCell label="更新" value={statistics.rss.updatedCount} />
                  <StatCell label="既存" value={statistics.rss.skippedCount} />
                  <StatCell label="変換" value={statistics.rss.convertedCount} />
                  <StatCell label="変換失敗" value={statistics.rss.conversionFailedCount} />
                  <StatCell label="未変換" value={statistics.rss.conversionSkippedCount} />
                  <StatCell label="最終実行" value={formatStatsDate(statistics.rss.lastFinishedAt)} />
                </div>
              </section>

              <section className="stats-section">
                <div className="stats-section-title">最近のAPIログ</div>
                <div className="stats-table api-log-table">
                  <span>日時</span>
                  <span>状態</span>
                  <span>用途</span>
                  <span>件数</span>
                  <span>Token(total/cached)</span>
                  <span>モデル</span>
                  {statistics.recentApiRequests.map((request) => (
                    <ApiLogRow key={request.id} request={request} />
                  ))}
                </div>
              </section>

              <section className="stats-section">
                <div className="stats-section-title">最近のRSSログ</div>
                <div className="stats-table rss-log-table">
                  <span>日時</span>
                  <span>状態</span>
                  <span>取得</span>
                  <span>新規/更新</span>
                  <span>変換</span>
                  {statistics.recentRssRuns.map((run) => (
                    <RssLogRow key={run.id} run={run} />
                  ))}
                </div>
              </section>

              <section className="stats-section">
                <div className="stats-section-title">最近の元記事取得ログ</div>
                <div className="stats-table article-fetch-log-table">
                  <span>日時</span>
                  <span>状態</span>
                  <span>URL</span>
                  <span>Robots.txt</span>
                  <span>サイズ</span>
                  <span>時間</span>
                  {statistics.recentArticleFetches.map((fetch) => (
                    <ArticleFetchLogRow key={fetch.id} fetch={fetch} />
                  ))}
                </div>
              </section>
            </>
          ) : (
            <div className="empty-state">統計情報を取得できませんでした。</div>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="stat-cell">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{typeof value === "number" ? value.toLocaleString() : value}</span>
    </div>
  );
}

function ApiLogRow({ request }: { request: StatisticsSummary["recentApiRequests"][number] }) {
  const purposeLabel: Record<string, string> = {
    title_transform: "スレタイ変換",
    thread_response: "初期スレ",
    thread_reply: "返信生成",
    article_summary: "本文要約"
  };
  const tokenStr = request.totalTokenCount != null
    ? `${request.totalTokenCount.toLocaleString()}${request.cachedContentTokenCount ? ` / ${request.cachedContentTokenCount.toLocaleString()}↩` : ""}`
    : "-";
  return (
    <>
      <span>{formatStatsDate(request.finishedAt)}</span>
      <span>{formatStatus(request.status)}</span>
      <span>{purposeLabel[request.purpose] ?? request.purpose}</span>
      <span>{request.itemCount}</span>
      <span title={`prompt: ${request.promptTokenCount ?? "N/A"} / candidates: ${request.candidatesTokenCount ?? "N/A"}`}>{tokenStr}</span>
      <span>{request.model}</span>
    </>
  );
}

function RssLogRow({ run }: { run: StatisticsSummary["recentRssRuns"][number] }) {
  return (
    <>
      <span>{formatStatsDate(run.finishedAt)}</span>
      <span>{formatStatus(run.status)}</span>
      <span>{run.fetchedCount}</span>
      <span>
        {run.insertedCount}/{run.updatedCount}
      </span>
      <span>{run.convertedCount}</span>
    </>
  );
}

function ArticleFetchLogRow({ fetch }: { fetch: StatisticsSummary["recentArticleFetches"][number] }) {
  const sizeKb = fetch.contentSize > 0 ? (fetch.contentSize / 1024).toFixed(1) : "-";
  return (
    <>
      <span>{formatStatsDate(fetch.fetchedAt)}</span>
      <span className={fetch.status === "error" ? "text-error" : ""}>
        {fetch.status === "success" ? "成功" : "失敗"}
      </span>
      <span className="text-left-align" title={fetch.url}>
        {fetch.url}
      </span>
      <span>{fetch.robotsResult}</span>
      <span>{sizeKb} KB</span>
      <span>{fetch.elapsedMs} ms</span>
    </>
  );
}
