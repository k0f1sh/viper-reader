import { Readability } from "@mozilla/readability";
import { JSDOM, VirtualConsole } from "jsdom";

export class EmptyArticleError extends Error {}

export function extractArticleText(html: string, url: string): string {
  const virtualConsole = new VirtualConsole().forwardTo(console, {
    jsdomErrors: ["unhandled-exception", "resource-loading"]
  });
  const dom = new JSDOM(html, { url, virtualConsole });
  try {
    const text = new Readability(dom.window.document).parse()?.textContent;
    if (!text?.trim()) throw new EmptyArticleError("本文が見つかりません。");
    return text.replace(/\r\n?/g, "\n").replace(/[ \u00a0]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    dom.window.close();
  }
}
