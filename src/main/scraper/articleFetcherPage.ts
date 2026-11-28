import { ArticlePage, createArticleFetcher } from "./articleFetcher.js";

import BiwaScheme from "./biwascheme.mjs";
const run = createArticleFetcher(BiwaScheme);

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== location.origin || event.data !== "article-fetcher:port") return;
  const [port] = event.ports;
  if (!port) return;

  port.onmessage = ({ data: { url, source } }) => {
    function call<T>(request: object): Promise<T> {
      return new Promise(resolve => {
        port.onmessage = event => resolve(event.data);
        port.postMessage(request);
      });
    }

    void run(url, source, async target => {
      const page = await call<{ text: string; url: string }>({ kind: "get", url: target });
      return new ArticlePage(page.text, page.url);
    }, (html, target) => call<string>({ kind: "extract", html, url: target }))
      .then(result => port.postMessage({ kind: "result", result }))
      .catch(() => port.postMessage({ kind: "error" }));
  };
});
