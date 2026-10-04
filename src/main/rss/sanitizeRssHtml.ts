import sanitizeHtml from "sanitize-html";

export function sanitizeRssHtml(html: string, articleUrl: string): string {
  return sanitizeHtml(html, {
    allowedTags: ["a", "p", "br", "strong", "em", "code", "ul", "ol", "li", "pre", "div", "blockquote"],
    allowedAttributes: { a: ["href"] },
    allowedSchemes: ["https", "http"],
    allowProtocolRelative: false,
    nonTextTags: ["script", "style", "textarea", "option", "iframe", "svg", "math"],
    transformTags: {
      a: (_tag, attributes): sanitizeHtml.Tag => {
        try {
          if (!attributes.href?.trim()) return { tagName: "a", attribs: {} };
          const url = new URL(attributes.href, articleUrl);
          if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) {
            return { tagName: "a", attribs: { href: url.href } };
          }
        } catch { /* Invalid links are displayed as text. */ }
        return { tagName: "a", attribs: {} };
      }
    }
  });
}
