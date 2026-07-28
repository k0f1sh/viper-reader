import crypto from "node:crypto";
import { VIP_TITLE_SYSTEM_INSTRUCTION } from "../ai/promptParts.js";

/**
 * RSS記事タイトルを「2000年代後半（2005年〜2009年頃）の2chニュー速VIP板」風のスレタイに変換するプロンプト。
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
export function buildVipTitlePromptHash(useSummary: boolean): string {
  return crypto
    .createHash("sha256")
    .update(`vip-title-v9\n${VIP_TITLE_SYSTEM_INSTRUCTION}\nsource:${useSummary ? "summary" : "title"}`)
    .digest("hex")
    .slice(0, 16);
}

export type VipTitlePromptItem = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  rawSummary: string | null;
};

export function buildVipTitlePrompt(feedTitle: string, items: VipTitlePromptItem[], useSummary = false): string {
  return `あなたは2000年代後半（2005年〜2009年頃）の2ちゃんねる「ニュース速報(VIP)板」のスレタイ職人です。
さまざまな分野の記事やニュースの${useSummary ? "RSS概要を主な材料として" : "元タイトルを材料として"}、当時の「ニュース速報(VIP)板」のスレタイ風に変換してください。

ルール:
- 出力はJSON配列だけ。Markdownや説明文は禁止。
- 各要素は {"feedItemId":"...","vipTitle":"..."} の形にする。
- feedItemIdは入力値をそのまま返す。
${useSummary
  ? "- rssSummaryの内容を材料にし、記事の要点が伝わるタイトルにする。rssSummaryが空の場合だけtitleへフォールバックする。"
  : "- 元タイトルの意味を残す。"}
- 元情報の意味を保ちつつ、2005年〜2009年頃のVIPっぽい勢い・ツッコミ・祭り感を足す。
- 記事の主題に合う観点と語彙を使い、元情報と無関係な分野の用語、比喩、専門家視点を持ち込まない。
- 使ってよいノリ: 【速報】、【悲報】、【朗報】、ワロタ、クソワロタ、〜じゃね？、〜ｗｗｗｗｗｗ、ハジマタ、オワタ。
- 面白さは草、誇張、古いネットスラング、ツッコミで出す。煽り・罵倒・見下し・人格攻撃をタイトルの中心にしない。
- 記事内容への懸念は、攻撃的な断定ではなく軽いツッコミとして表現する。
- 「〜草」「エグい」「〜しか勝たん」など2015年以降のネットスラングは禁止。
- なんJ・猛虎弁を強く想起させる「ワイ」「ンゴ」「ニキ」「〜やで」「〜やろ」などは使わない。一人称が必要なら「俺」「俺氏」を使う。
- 「〜の件」は使いすぎない。
- 差別、露骨な誹謗中傷、性的表現、個人攻撃、「情弱乙」「無能」「バカ」「ゴミ」「終わってる」のような攻撃的評価語は入れない。
- 1件あたり60文字以内を目安にする。

RSSソース: ${feedTitle}

入力:
${JSON.stringify(
  items.map((item) => ({
    feedItemId: item.id,
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
    ...(useSummary ? { rssSummary: item.rawSummary } : {})
  }))
)}`;
}
