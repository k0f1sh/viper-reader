import crypto from "node:crypto";
import { BOARD_TITLE_SYSTEM_INSTRUCTION } from "../ai/promptParts.js";

/**
 * RSS記事タイトルを「2000年代後半（2005年〜2009年頃）の日本語匿名掲示板」風のスレタイに変換するプロンプト。
 *
 * 入力:
 * - RSSソース名
 * - feedItemId/title/url/publishedAt の配列
 *
 * 出力:
 * - JSON配列のみ
 * - 各要素は { feedItemId, threadTitle }
 *
 * DBキャッシュ:
 * - promptHash は thread_titles.prompt_hash に保存する。
 * - プロンプトの意味や出力仕様を変えたら hash を更新し、既存キャッシュと区別する。
 */
export function buildThreadTitlePromptHash(useSummary: boolean): string {
  return crypto
    .createHash("sha256")
    .update(`thread-title-v13\n${BOARD_TITLE_SYSTEM_INSTRUCTION}\nsource:${useSummary ? "summary" : "title"}`)
    .digest("hex")
    .slice(0, 16);
}

export type ThreadTitlePromptItem = {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  rawSummary: string | null;
};

export function buildThreadTitlePrompt(feedTitle: string, items: ThreadTitlePromptItem[], useSummary = false): string {
  return `あなたは2000年代後半（2005年〜2009年頃）の日本語匿名掲示板のスレタイ職人です。
さまざまな分野の記事やニュースの${useSummary ? "RSS概要を主な材料として" : "元タイトルを材料として"}、当時の匿名掲示板のスレタイ風に変換してください。

ルール:
- 出力はJSON配列だけ。Markdownや説明文は禁止。
- 各要素は {"feedItemId":"...","threadTitle":"..."} の形にする。
- feedItemIdは入力値をそのまま返す。
${useSummary
  ? "- rssSummaryの内容を材料にし、記事の要点が伝わるタイトルにする。rssSummaryが空の場合だけtitleへフォールバックする。"
  : "- 元タイトルの意味を残す。"}
- 元情報の主題、視点、因果関係を保つ。元情報にない話者の体験談や感情を作ったり、筆者・登場人物・読者の立場を勝手に一人称へ置き換えたりしない。
- 面白さや引っかかりは、記事固有の人物・製品・出来事・数値・発言・意外な組み合わせから引き出す。どの記事にも使えるリアクションや決まり文句だけを後付けして済ませない。
- 深刻な話題を除き、元タイトルをニュース見出しのように整えるだけで終わらせず、当時の匿名掲示板らしいバカバカしい勢い、祭り感、くだらなさを明確に加える。
- 記事内容に合う大げさな盛り上げ、素朴な疑問、短い引用、対比、驚き、雑なツッコミなどを使い分ける。草、連続する感嘆符、顔文字も、題材と噛み合うなら積極的に使ってよい。
- 元情報の具体的な題材そのものを面白がる。架空の話者や体験を作らなくても、読み手が思わず開きたくなる、ちょっとバカで勢いのあるスレタイにする。
- 当時らしい語感の参考として、次のような表現がある。これは語感のパレットであり、全部を使う必要はない。記事と自然につながるものだけを選び、同じ語や型を機械的に付けない。
  - 勢い・祭り感: 「ちょｗｗｗ」「ｷﾀ━━━━(ﾟ∀ﾟ)━━━━!!」「ｷﾀｺﾚ」「祭りｷﾀｺﾚ」「これは伸びる」「これは流行る」「始まったな」「夢がひろがりんぐ」「うはｗｗｗｗおｋｗｗｗｗ」
  - 驚き・ツッコミ: 「ワロタ」「クソワロタ」「〜じゃね？」「テラ○○」「これはひどい」「どうしてこうなった」「自重しろ」「常識的に考えて」
  - 展開・結末: 「〜した結果ｗｗｗ」「〜終了のお知らせ」「＼(^o^)／ｵﾜﾀ」「解散」「胸が熱くなるな」
  - スレらしい呼びかけ: 「おまいら〜」「〜だけど質問ある？」「誰得」
- 2010年代半ば以降に定着した「〜は草」「〜草」「エグい」「スパダリ」「〜しか勝たん」などは使わない。
- 異なる掲示板文化の方言を強く想起させる「ワイ」「ンゴ」「ニキ」「〜やで」「〜やろ」などを混ぜない。
- 事故、災害、死亡、病気、犯罪被害など深刻な話題では、当事者や被害を茶化さず、事実の重さに合う抑制した表現にする。
- 入力配列全体に勢いのあるタイトルを十分に含める。ただし、同じ書き出し、語尾、構文、感情表現が続かないようにし、各記事に最も合う異なる切り口を選ぶ。
- 2005年〜2009年頃の語感を保ち、それより後の時代に定着した言い回しや、異なる文化圏の掲示板方言を混ぜない。
- 煽り、罵倒、見下し、人格攻撃、差別、性的表現を面白さに使わない。
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
