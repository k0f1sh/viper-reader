/** Electronの記事ブラウザ用。実体との互換性を保つため、今回のHTTP取得UA更新対象外。 */
export const ARTICLE_BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** 記事本文とrobots.txtのHTTP取得用。Chrome Stableの短縮UA形式に合わせる。 */
export const ARTICLE_FETCH_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
