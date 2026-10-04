import type { CommandHookProcessState } from "../../shared/types";

type CommandHookNoticeProps = {
  commandHookRunning: boolean;
  commandHookMessage: string;
  commandHookOutput: string;
  commandHookProcess: CommandHookProcessState | null;
  onDismissCommandHookMessage: () => void;
};

export function CommandHookNotice({ commandHookRunning, commandHookMessage, commandHookOutput, commandHookProcess, onDismissCommandHookMessage }: CommandHookNoticeProps) {
  return commandHookMessage ? (
            <div className="command-hook-notice" role="status">
              <div className="command-hook-notice-content">
                <div className="command-hook-heading">外部フック</div>
                <span>{commandHookMessage}</span>
                {commandHookProcess ? (
                  <div className="command-hook-process" aria-label="外部プロセスの状態">
                    <div>コマンド: {commandHookProcess.command}</div>
                    <div>
                      PID: {commandHookProcess.pid ?? "—"} / 状態: {{ running: "実行中", completed: "正常終了", failed: "異常終了", "spawn-failed": "起動失敗" }[commandHookProcess.status]}
                      {commandHookProcess.exitCode !== null ? ` / 終了コード: ${commandHookProcess.exitCode}` : ""}
                      {commandHookProcess.signal ? ` / シグナル: ${commandHookProcess.signal}` : ""}
                    </div>
                  </div>
                ) : commandHookRunning ? <div className="command-hook-process">状態: 起動中</div> : null}
                {commandHookOutput ? <pre className="command-hook-output" aria-label="外部コマンドの出力">{commandHookOutput}</pre> : null}
              </div>
              <button type="button" aria-label="フック通知を閉じる" title="通知を閉じる" onClick={onDismissCommandHookMessage}>✗</button>
            </div>
  ) : null;
}
