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

export const vipThreadResponsePromptHash = "vip-thread-response-v12";
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

export function buildVipThreadResponsePrompt(input: VipThreadResponsePromptInput): string {
  if (input.scrapedBody === null) {
    return `# 目的
2010年前後（2008年〜2012年頃）の2ちゃんねる「ニュース速報(VIP)板」における、元記事の本文取得（スクレイピング）に失敗した際のお祭り騒ぎ（または解散ムード）のスレッドの流れを再現してください。

# 必須要件（レスの役割分担と構成）
1. **レス番2 (no: 2) の役割**:
   - 「記事の本文が取得できませんでした。終了…。」や「ソースが読めない（またはrobots.txtで弾かれた）からこのスレは終了しました」といった旨を、2ch住民の口調で書き込んでください。
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
- no: 2 は必ず本文取得不可の報告レスとし、no: 3以降はその反応レスとしてください。

# 板ごとの住民設定
${input.residentPrompt?.trim() ? input.residentPrompt.trim() : "追加設定なし。"}

# スレ情報
スレタイ: ${input.vipTitle}
元記事タイトル: ${input.originalTitle}
URL: ${input.url}
記事日時: ${input.publishedAt || "不明"}`;
  }

  const bodyText = input.scrapedBody;

  return `# 目的
2010年前後（2008年〜2012年頃）の2ちゃんねる「ニュース速報(VIP)板」の、一般ユーザー（VIPPER）によるレスの文体や雰囲気を再現してください。

# 必須要件（レスの役割分担と構成）
1. **レス番2 (no: 2) の役割**:
   - 技術ニュースを日常的に追い、記事のソースを読んで要点を整理する「事情通のVIPPER」として書いてください。
   - 専門家を自称したり、記事にない背景を知ったかぶりしたりせず、記事から確認できる技術的な中心点と、エンジニアにとっての実用上の影響を短く伝えてください。
   - 事実と感想を混同せず、記事だけでは断言できない点は「そこはまだ分からん」「ソースだけでは判断できん」などと明示してください。
   - 書式は記事に合わせ、次の形式から自然なものを選んでください。毎回同じ構成にはしないでください：
     - 記事の要点を2〜3行に圧縮する短文整理。
     - 何が起きたか、技術的なポイント、実用上の影響を短い段落で順に話す。
     - 最重要点を最初に出し、その理由や注意点を補足する速報整理。
     - 実装・運用・保守への影響を中心に整理する現場目線。
     - 記事の主張と、まだ判断できない点を分ける検証目線。
   - 箇条書き、短い段落、1〜3行の改行を記事に合わせて使い分けてください。固定の見出しや定型文を毎回繰り返さないでください。
   - スレッド開始直後のレスなので、「今北産業」「今来た」など途中参加を示す表現は使わないでください。
   - 口調は事情通であっても堅い解説調にせず、VIP住民らしい軽さを保ってください。
   - **>>3を煽る文言は入れないでください。**
2. **レス番3 (no: 3) 以降の役割**:
   - レス2 (no: 2) の情報整理をベースにして、住民たちが議論や雑談を交わす流れにしてください。
   - レス2に対して「情強きた」「なるほど」「それってつまり～ってこと？」「うはwwwwおkwwwwww」「夢が広がりングwwwwwwww」といった様々なリアクションを取り、議論を展開してください。

${VIP_STYLE_RULES}

${VIP_NG_RULES}

# 出力形式
- JSON配列だけを返してください。Markdownや説明文は禁止。
- 10個〜15個程度のレスを生成してください。
- 各要素は {"no":2,"name":"以下、名無しにかわりましてVIPがお送りします","mail":"sage","date":"2010/xx/xx(x) hh:mm:ss.xx","id":"${VIP_ID_FORMAT_DESC}","body":"..."} の形にしてください。
- mail は原則 "sage" にしてください。本文で「sage」と言及する場合も、メール欄 mail に "sage" を入れてください。
- no は 2 から始まり、3以降は重複のないように連番（3, 4, 5...）にしてください（例: 2, 3, 4, 5...）。
- no: 2 は必ず事情通の情報整理レスとし、no: 3以降はその議論レスとしてください。
- date は それっぽい日時にしてください。
- body は短く、改行を自然に含めてください。

# 板ごとの住民設定
${input.residentPrompt?.trim() ? input.residentPrompt.trim() : "追加設定なし。標準的な2010年前後のVIPPERとして振る舞ってください。"}

# スレ情報
スレタイ: ${input.vipTitle}
元記事タイトル: ${input.originalTitle}
URL: ${input.url}
記事日時: ${input.publishedAt || "不明"}

# 情報ソース（記事要約・スクレイピング本文）
${bodyText}`;
}
