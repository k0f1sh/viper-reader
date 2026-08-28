import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { normalizePostBody } from "../../shared/postBody";

type PostBodyProps = {
  body: string;
  onAnchorClick: (no: number) => void;
  onAnchorMouseEnter?: (no: number, event: ReactMouseEvent<HTMLElement>) => void;
  onAnchorMouseLeave?: () => void;
  showUrlCopyButton?: boolean;
};

export function PostBody({ body, onAnchorClick, onAnchorMouseEnter, onAnchorMouseLeave, showUrlCopyButton = false }: PostBodyProps) {
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
  }, []);

  async function copyUrl(url: string) {
    if (!window.viperReader) return;
    await window.viperReader.copyText(url);
    setCopiedUrl(url);
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopiedUrl(null), 1500);
  }

  return (
    <>
      {splitBody(normalizePostBody(body)).map((part, index) => {
        if (part.type === "url") {
          const isCopied = copiedUrl === part.value;
          return (
            <span className="post-url" key={`${part.value}-${index}`}>
              <button className="post-link" onClick={() => openPostUrl(part.value)} type="button">
                {part.value}
              </button>
              {showUrlCopyButton ? (
                <button
                  aria-label={isCopied ? "URLをコピーしました" : "URLをクリップボードにコピー"}
                  className={`post-url-copy-button ${isCopied ? "is-copied" : ""}`}
                  onClick={() => void copyUrl(part.value)}
                  title={isCopied ? "コピーしました" : "URLをコピー"}
                  type="button"
                >
                  {isCopied ? (
                    <svg aria-hidden="true" viewBox="0 0 16 16"><path d="m3 8 3 3 7-7" /></svg>
                  ) : (
                    <svg aria-hidden="true" viewBox="0 0 16 16"><rect height="9" rx="1" width="8" x="5" y="2" /><path d="M3 5v8a1 1 0 0 0 1 1h7" /></svg>
                  )}
                </button>
              ) : null}
            </span>
          );
        }
        if (part.type === "anchor") {
          const postNo = parseInt(part.value.replace(">>", ""), 10);
          return (
            <button
              className="post-link"
              key={`${part.value}-${index}`}
              onClick={() => onAnchorClick(postNo)}
              onMouseEnter={(event) => onAnchorMouseEnter?.(postNo, event)}
              onMouseLeave={onAnchorMouseLeave}
              type="button"
            >
              {part.value}
            </button>
          );
        }
        return <span key={`${part.value}-${index}`}>{part.value}</span>;
      })}
    </>
  );
}

function splitBody(body: string): Array<{ type: "text" | "url" | "anchor"; value: string }> {
  const parts: Array<{ type: "text" | "url" | "anchor"; value: string }> = [];
  const pattern = /(https?:\/\/[^\s<>"']+)|(>>\d+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(body)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", value: body.slice(lastIndex, match.index) });
    }

    const matchedStr = match[0];
    if (matchedStr.startsWith(">>")) {
      parts.push({ type: "anchor", value: matchedStr });
    } else {
      const { url, trailingText } = trimTrailingUrlPunctuation(matchedStr);
      parts.push({ type: "url", value: url });
      if (trailingText) {
        parts.push({ type: "text", value: trailingText });
      }
    }
    lastIndex = match.index + matchedStr.length;
  }

  if (lastIndex < body.length) {
    parts.push({ type: "text", value: body.slice(lastIndex) });
  }

  return parts;
}

function trimTrailingUrlPunctuation(value: string): { url: string; trailingText: string } {
  const url = value.replace(/[),.。]+$/g, "");
  return {
    url,
    trailingText: value.slice(url.length)
  };
}

function openPostUrl(url: string) {
  void window.viperReader?.openExternalUrl(url);
}
