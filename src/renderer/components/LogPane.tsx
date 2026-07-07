import { useEffect, useRef } from "react";
import type { AppLogEntry } from "../../shared/types";

type LogPaneProps = {
  logs: AppLogEntry[];
};

export function LogPane({ logs }: LogPaneProps) {
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="log-pane" aria-label="ログ">
      <div className="pane-title log-pane-title">
        <span>ログ</span>
        <span className="log-count">{logs.length}</span>
      </div>
      <div className="log-list" ref={listRef}>
        {logs.length === 0 ? (
          <div className="log-empty">ログはまだありません</div>
        ) : (
          logs.map((entry) => (
            <div className={`log-row is-${entry.level}`} key={entry.id}>
              <span className="log-time">{formatLogTime(entry.createdAt)}</span>
              <span className="log-level">{entry.level.toUpperCase()}</span>
              <span className="log-message" title={entry.message}>
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function formatLogTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "--:--:--";
  }

  const pad = (number: number) => String(number).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
