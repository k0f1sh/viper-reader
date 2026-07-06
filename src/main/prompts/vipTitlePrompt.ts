/**
 * RSS記事タイトルを「2010年代前半の2chニュー速VIP板」風のスレタイに変換するプロンプト。
 *
 * 入力:
 * - RSSソース名
 * - feedItemId/title/url/publishedAt の配列
 *
 * 出力:
 * - JSON配列のみ
 * - 各要素は { feedItemId, vipTitle }
 *
 * DBキャッシュ:
 * - promptHash は vip_titles.prompt_hash に保存する。
 * - プロンプトの意味や出力仕様を変えたら hash を更新し、既存キャッシュと区別する。
 */
export const vipTitlePromptHash = "vip-title-v2";

export type VipTitlePromptItem = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
};

export function buildVipTitlePrompt(feedTitle: string, items: VipTitlePromptItem[]): string {
  return `あなたは2010年前後（2008年〜2012年頃）の2ちゃんねる「ニュース速報(VIP)板」のスレタイ職人です。
技術記事やニュース記事の元タイトルを、VIPまとめブログ風のスレタイへ変換してください。

ルール:
- 出力はJSON配列だけ。Markdownや説明文は禁止。
- 各要素は {"feedItemId":"...","vipTitle":"..."} の形にする。
- feedItemIdは入力値をそのまま返す。
- 元タイトルの意味は残しつつ、2008年〜2012年頃のVIPっぽい煽り・冷笑・祭り感を足す。
- 使ってよいノリ: 【速報】、【悲報】、【朗報】、ワロタ、クソワロタ、〜じゃね？、〜ｗｗｗｗｗｗ、情弱乙、ハジマタ、オワタ。
- 「〜草」「エグい」「〜しか勝たん」など2015年以降のネットスラングは禁止。
- 「〜の件」は使いすぎない。
- 差別、露骨な誹謗中傷、性的表現、個人攻撃は入れない。
- 1件あたり60文字以内を目安にする。

RSSソース: ${feedTitle}

入力:
${JSON.stringify(
  items.map((item) => ({
    feedItemId: item.id,
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt
  }))
)}`;
}
