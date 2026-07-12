import { useEffect, useMemo, useRef, useState } from "react";
import type { AppLogEntry } from "../../shared/types";

type LogPaneProps = {
  logs: AppLogEntry[];
};

export function LogPane({ logs }: LogPaneProps) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const [filter, setFilter] = useState<"all" | "warn" | "error">("all");
  const [isFollowing, setIsFollowing] = useState(true);
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);

  const groupedLogs = useMemo(() => groupConsecutiveLogs(logs), [logs]);
  const visibleLogs = useMemo(
    () => groupedLogs.filter((entry) => filter === "all" ? true : entry.level === filter),
    [filter, groupedLogs]
  );
  const issueCount = logs.filter((entry) => entry.level === "warn" || entry.level === "error").length;

  useEffect(() => {
    const list = listRef.current;
    if (list && isFollowing) {
      list.scrollTop = list.scrollHeight;
    }
  }, [visibleLogs, isFollowing]);

  function handleScroll() {
    const list = listRef.current;
    if (!list) return;
    const isAtBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
    if (!isAtBottom && isFollowing) setIsFollowing(false);
  }

  return (
    <div className="log-pane" aria-label="ログ">
      <div className="pane-title log-pane-title">
        <span>イベントログ</span>
        <span className={`log-health ${issueCount > 0 ? "has-issues" : ""}`}>
          {issueCount > 0 ? `注意 ${issueCount}` : "正常"}
        </span>
      </div>
      <div className="log-toolbar" aria-label="ログ表示設定">
        <select aria-label="重要度で絞り込み" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
          <option value="all">すべて ({logs.length})</option>
          <option value="warn">警告 ({logs.filter((entry) => entry.level === "warn").length})</option>
          <option value="error">エラー ({logs.filter((entry) => entry.level === "error").length})</option>
        </select>
        <button
          className={isFollowing ? "is-active" : ""}
          onClick={() => setIsFollowing((current) => !current)}
          title={isFollowing ? "新しいログを自動追従中" : "自動追従を再開"}
          type="button"
        >
          {isFollowing ? "▼ 追従中" : "追従する"}
        </button>
      </div>
      <div className="log-list" ref={listRef} onScroll={handleScroll}>
        {visibleLogs.length === 0 ? (
          <div className="log-empty">{logs.length === 0 ? "ログはまだありません" : "該当するログはありません"}</div>
        ) : (
          visibleLogs.map((entry) => (
            <button
              className={`log-row is-${entry.level} ${expandedGroupId === entry.id ? "is-expanded" : ""}`}
              key={entry.id}
              onClick={() => setExpandedGroupId((current) => current === entry.id ? null : entry.id)}
              title="クリックで全文を表示"
              type="button"
            >
              <span className="log-time">{formatLogTime(entry.createdAt)}</span>
              <span className="log-level">{formatLogLevel(entry.level)}</span>
              <span className="log-message">
                {entry.message}
              </span>
              {entry.count > 1 ? <span className="log-repeat">×{entry.count}</span> : null}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

type GroupedLogEntry = AppLogEntry & { count: number };

function groupConsecutiveLogs(logs: AppLogEntry[]): GroupedLogEntry[] {
  const groups: GroupedLogEntry[] = [];
  for (const entry of logs) {
    const previous = groups.at(-1);
    if (previous && previous.level === entry.level && previous.message === entry.message) {
      previous.count += 1;
      previous.createdAt = entry.createdAt;
      continue;
    }
    groups.push({ ...entry, count: 1 });
  }
  return groups;
}

function formatLogLevel(level: AppLogEntry["level"]): string {
  if (level === "error") return "失敗";
  if (level === "warn") return "警告";
  return "情報";
}

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  const pad = (number: number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
