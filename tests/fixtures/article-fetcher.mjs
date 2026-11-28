import { readFileSync } from "node:fs";
import BiwaScheme from "biwascheme";
import { ArticlePage, createArticleFetcher } from "../../dist/main/scraper/articleFetcher.js";
import { extractArticleText } from "../../dist/main/scraper/extractArticleText.js";

const standard = readFileSync(new URL("../../assets/standard-article.scm", import.meta.url), "utf8");
const run = createArticleFetcher(BiwaScheme);

export function runArticleFetcher(url, getPage, source = standard, signal = new AbortController().signal) {
  return run(url, source, target => getPage(target, signal), async (html, url) => extractArticleText(html, url));
}

export { ArticlePage };
