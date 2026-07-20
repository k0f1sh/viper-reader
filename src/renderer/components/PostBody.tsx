import type { MouseEvent as ReactMouseEvent } from "react";

type PostBodyProps = {
  body: string;
  onAnchorClick: (no: number) => void;
  onAnchorMouseEnter?: (no: number, event: ReactMouseEvent<HTMLElement>) => void;
  onAnchorMouseLeave?: () => void;
};

export function PostBody({ body, onAnchorClick, onAnchorMouseEnter, onAnchorMouseLeave }: PostBodyProps) {
  const displayBody = normalizeDisplayBody(body);
  return (
    <>
      {splitBody(displayBody).map((part, index) => {
        if (part.type === "url") {
          return (
            <button className="post-link" key={`${part.value}-${index}`} onClick={() => openPostUrl(part.value)} type="button">
              {part.value}
            </button>
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

function normalizeDisplayBody(body: string): string {
  return body.includes("\n") ? body : body.replace(/\\n/g, "\n");
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
