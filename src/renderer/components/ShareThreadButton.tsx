import { useEffect, useState } from "react";
import type { ThreadDetail } from "../../shared/types";
import { normalizePostBody } from "../../shared/postBody";

export function ShareThreadButton({ thread }: { thread: ThreadDetail }) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const summary = thread.posts.find((post) => post.no === 2 && !post.isUser)?.body;
  const canCopy = Boolean(summary?.trim() && /^https?:\/\//i.test(thread.url));

  useEffect(() => {
    if (status !== "copied" && status !== "error") return;
    const timer = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  async function copyThread() {
    if (!canCopy || !summary) return;
    setStatus("copying");
    try {
      if (!window.viperReader) throw new Error("Clipboard API unavailable");
      await window.viperReader.copyText(
        `${thread.originalTitle}\n${thread.url}\n\n【要約】\n${normalizePostBody(summary)}\n\n※ViperReaderによるAI要約`
      );
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }

  return (
    <span>
      <button
        className="deep-dive-button"
        type="button"
        disabled={!canCopy || status === "copying"}
        onClick={() => void copyThread()}
        title={!summary?.trim()
          ? "レス生成後にコピーできます"
          : !canCopy ? "元記事URLがないためコピーできません" : "元記事タイトル・URL・レス2の要約をコピー"}
      >
        {status === "copied" ? "コピー完了" : status === "copying" ? "コピー中..." : "要約をコピー"}
      </button>
      <span role="status">
        {status === "error" ? " コピーに失敗しました。再度お試しください。" : ""}
      </span>
    </span>
  );
}
