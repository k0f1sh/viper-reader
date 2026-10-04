import { useEffect, useRef, useState } from "react";
import type { ThreadDetail, CommandHookProcessState } from "../../shared/types";

export function useCommandHook(thread: ThreadDetail | null, viewMode: "replies" | "browser") {
  const [configured, setConfigured] = useState(false);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState("");
  const busy = useRef(false);
  const activeThreadId = useRef<string | null>(null);
  const dismissed = useRef(false);
  const activeThreadTitle = useRef("");
  const [output, setOutput] = useState("");
  const [process, setProcess] = useState<CommandHookProcessState | null>(null);

  useEffect(() => window.viperReader?.onCommandHookProcess((data) => {
    if (data.threadId !== activeThreadId.current || dismissed.current) return;
    setProcess(data.process);
    if (data.process.status !== "running") {
      const status = data.process.status === "completed" ? "完了" : data.process.status === "spawn-failed" ? "起動失敗" : "異常終了";
      setMessage(`外部フック${status}: ${activeThreadTitle.current}`);
    }
  }), []);

  useEffect(() => window.viperReader?.onCommandHookOutput((data) => {
    if (data.threadId === activeThreadId.current && !dismissed.current) {
      setOutput(data.output);
    }
  }), []);

  async function reload() {
    try {
      setConfigured(Boolean(await window.viperReader?.getCommandHook()));
    } catch {
      setConfigured(false);
      setMessage("外部フック設定を読み込めません。設定画面で確認してください。");
    }
  }
  useEffect(() => { void reload(); }, []);

  const canRun = configured && Boolean(thread?.url) && viewMode === "replies" && !running;
  async function run() {
    if (!canRun || busy.current || !thread || !window.viperReader) return;
    busy.current = true;
    activeThreadId.current = thread.id;
    activeThreadTitle.current = thread.threadTitle;
    dismissed.current = false;
    setOutput("");
    setProcess(null);
    setRunning(true);
    // Retain the originating thread title when the selection changes during execution.
    const label = thread.threadTitle;
    setMessage(`外部フック実行中: ${label}`);
    try {
      await window.viperReader.runCommandHook(thread.id);
      if (!dismissed.current) setMessage(`外部フック完了: ${label}`);
    } catch (error) {
      if (!dismissed.current) setMessage(`${label}: ${error instanceof Error ? error.message : "外部フックの実行に失敗しました。"}`);
    } finally {
      activeThreadId.current = null;
      busy.current = false;
      setRunning(false);
    }
  }
  function clearMessage() {
    dismissed.current = true;
    setMessage("");
    setOutput("");
    setProcess(null);
  }
  return { canRun, running, message, output, process, run, reload, clearMessage };
}
