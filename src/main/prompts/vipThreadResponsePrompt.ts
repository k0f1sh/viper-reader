/**
 * RSS本文を読んだVIPPERたちのレスを生成するプロンプト。
 *
 * 入力:
 * - VIP風スレタイ
 * - 元記事タイトル
 * - URL
 * - RSS本文
 * - スクレイピングした本文
 *
 * 出力:
 * - JSON配列のみ
 * - 各要素は { no, name, mail, date, id, body }
 * - no は 2 以降。1 はRSS本文そのものを表示するため生成しない。
 */

import { VIP_ID_FORMAT_DESC, VIP_NG_RULES, VIP_STYLE_RULES } from "./vipCommonRules.js";

export const vipThreadResponsePromptHash = "vip-thread-response-v9";
export const defaultResidentPromptHash = "default";

export type VipThreadResponsePromptInput = {
  vipTitle: string;
  originalTitle: string;
  url: string;
  rssBody: string;
  scrapedBody: string | null;
  publishedAt: string;
  residentPrompt: string | null;
};

export function buildVipThreadResponsePromptHash(residentPromptHash: string | null): string {
  return `${vipThreadResponsePromptHash}:${residentPromptHash ?? defaultResidentPromptHash}`;
}

const TWO_GET_LIST = `- 2get
- 2getズサー
- 2ｹﾞｯﾄ
- 2ｹﾞｯﾄｽﾞｻｰｰｰｰｰｰｰｰｰｰｰｰ
- 2なら>>3は俺の嫁
- 2なら>>3がジュース奢ってくれる
- 2なら宝くじ一等当選
- 1乙、2get
- あらかじめ2ゲットと言っておこう
- 2はもらった
- 2なら彼女ができる
- 2なら明日地球が滅亡する
- 2getだお（ ＾ω＾）`;

export function buildVipThreadResponsePrompt(input: VipThreadResponsePromptInput): string {
  if (input.scrapedBody === null) {
    return `# 目的
2010年前後（2008年〜2012年頃）の2ちゃんねる「ニュース速報(VIP)板」における、元記事の本文取得（スクレイピング）に失敗した際のお祭り騒ぎ（または解散ムード）のスレッドの流れを再現してください。

# 必須要件（レスの役割分担と構成）
1. **レス番2 (no: 2) の役割**:
   - 2getの文言は以下のリストからランダムに選んで使用してください：
${TWO_GET_LIST}
   - それに続けて「記事の本文が取得できませんでした。終了…。」や「ソースが読めない（またはrobots.txtで弾かれた）からこのスレは終了しました」といった旨を、2ch住民の口調で書き込んでください。
2. **レス番3 (no: 3) 以降の役割**:
   - レス2 (no: 2) の「本文が取得できない」「スレ終了」の報告を受け、住民たちが落胆したり、ネタにしたりして盛り上がる流れにしてください。
   - 例：「オワタｗｗｗｗ」「解散解散」「もう帰るわ」「スクレイピング規制されててクソワロタ」「>>2 乙。今日は解散だな」「このスレは>>2によって終了しました」など。

${VIP_STYLE_RULES}

${VIP_NG_RULES}
- 本文の内容を想像で捏造して解説することは絶対に避けてください。「取得に失敗した」という事実のみを扱ってください。

# 出力形式
- JSON配列だけを返してください。Markdownや説明文は禁止。
- 10個〜15個程度のレスを生成してください。
- 各要素は {"no":2,"name":"以下、名無しにかわりましてVIPがお送りします","mail":"sage","date":"2010/xx/xx(x) hh:mm:ss.xx","id":"${VIP_ID_FORMAT_DESC}","body":"..."} の形にしてください。
- mail は原則 "sage" にしてください。本文で「sage」と言及する場合も、メール欄 mail に "sage" を入れてください。
- no は 2 から始まり、3以降は重複のないように連番（3, 4, 5...）にしてください。
- no: 2 は必ず2get＆本文取得不可の報告レスとし、no: 3以降はその反応レスとしてください。

# 板ごとの住民設定
${input.residentPrompt?.trim() ? input.residentPrompt.trim() : "追加設定なし。"}

# スレ情報
スレタイ: ${input.vipTitle}
元記事タイトル: ${input.originalTitle}
URL: ${input.url}
記事日時: ${input.publishedAt || "不明"}`;
  }

  const bodyText = input.scrapedBody;
  const bodySource = "スクレイピングした記事の本文";

  return `# 目的
2010年前後（2008年〜2012年頃）の2ちゃんねる「ニュース速報(VIP)板」の、一般ユーザー（VIPPER）によるレスの文体や雰囲気を再現してください。

# 必須要件（レスの役割分担と構成）
1. **レス番2 (no: 2) の役割**:
   - 2getの文言は以下のリストからランダムに選んで使用してください：
${TWO_GET_LIST}
   - 2getの後、空行を入れてから記事の要約に入ってください。
   - 要約の書き方：
     - 1行目：誰の何に関するニュースか
     - 3〜5行の箇条書きで要点
     - 最後に一言コメント（私見）
   - 口調はVIP住民らしく。
   - **>>3を煽る文言は入れないでください。**
2. **レス番3 (no: 3) 以降の役割**:
   - レス2 (no: 2) の書き込み（要約）をベースにして、住民たちが議論や雑談を交わす流れにしてください。
   - レス2に対して「情強きた」「なるほど」「それってつまり～ってこと？」「うはwwwwおkwwwwww」「夢が広がりングwwwwwwww」といった様々なリアクションを取り、議論を展開してください。

${VIP_STYLE_RULES}

${VIP_NG_RULES}

# 出力形式
- JSON配列だけを返してください。Markdownや説明文は禁止。
- 10個〜15個程度のレスを生成してください。
- 各要素は {"no":2,"name":"以下、名無しにかわりましてVIPがお送りします","mail":"sage","date":"2010/xx/xx(x) hh:mm:ss.xx","id":"${VIP_ID_FORMAT_DESC}","body":"..."} の形にしてください。
- mail は原則 "sage" にしてください。本文で「sage」と言及する場合も、メール欄 mail に "sage" を入れてください。
- no は 2 から始まり、3以降は重複のないように連番（3, 4, 5...）にしてください（例: 2, 3, 4, 5...）。
- no: 2 は必ず要約レスとし、no: 3以降はその議論レスとしてください。
- date は それっぽい日時にしてください。
- body は短く、改行を自然に含めてください。

# 板ごとの住民設定
${input.residentPrompt?.trim() ? input.residentPrompt.trim() : "追加設定なし。標準的な2010年前後のVIPPERとして振る舞ってください。"}

# スレ情報
スレタイ: ${input.vipTitle}
元記事タイトル: ${input.originalTitle}
URL: ${input.url}
記事日時: ${input.publishedAt || "不明"}

# 情報ソース (${bodySource})
${bodyText}`;
}
