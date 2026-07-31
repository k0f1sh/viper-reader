/**
 * RSS本文を読んだ掲示板の住民たちのレスを生成するプロンプト。
 *
 * 入力:
 * - 匿名掲示板風スレタイ
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

import crypto from "node:crypto";
import { BOARD_SYSTEM_INSTRUCTION } from "../ai/promptParts.js";
import { BOARD_ID_FORMAT_DESC, BOARD_NG_RULES, BOARD_STYLE_RULES } from "./boardCommonRules.js";

export const threadResponsePromptHash = crypto
  .createHash("sha256")
  .update(`board-thread-response-v19\n${BOARD_SYSTEM_INSTRUCTION}`)
  .digest("hex")
  .slice(0, 16);
export const defaultResidentPromptHash = "default";

export type ThreadResponsePromptInput = {
  threadTitle: string;
  originalTitle: string;
  url: string;
  rssBody: string;
  scrapedBody: string | null;
  publishedAt: string;
  residentPrompt: string | null;
};

export function buildBoardThreadResponsePromptHash(residentPromptHash: string | null): string {
  return `${threadResponsePromptHash}:${residentPromptHash ?? defaultResidentPromptHash}`;
}

export function buildBoardThreadResponsePrompt(input: ThreadResponsePromptInput): string {
  if (input.scrapedBody === null) {
    return `# 目的
2000年代後半（2005年〜2009年頃）の日本語匿名掲示板における、元記事の本文取得（スクレイピング）に失敗した際のお祭り騒ぎ（または解散ムード）のスレッドの流れを再現してください。

# 必須要件（レスの役割分担と構成）
1. **レス番2 (no: 2) の役割**:
   - 「記事の本文が取得できませんでした。終了…。」や「ソースが読めない（またはrobots.txtで弾かれた）からこのスレは終了しました」といった旨を、匿名掲示板の住民の口調で書き込んでください。
2. **レス番3 (no: 3) 以降の役割**:
   - レス2 (no: 2) の「本文が取得できない」「スレ終了」の報告を受け、住民たちが落胆したり、ネタにしたりして盛り上がる流れにしてください。
   - 例：「オワタｗｗｗｗ」「解散解散」「もう帰るわ」「スクレイピング規制されててクソワロタ」「>>2 乙。今日は解散だな」「このスレは>>2によって終了しました」など。

${BOARD_STYLE_RULES}

${BOARD_NG_RULES}
- 本文の内容を想像で捏造して解説することは絶対に避けてください。「取得に失敗した」という事実のみを扱ってください。

# 出力形式
- JSON配列だけを返してください。Markdownや説明文は禁止。
- 10個〜15個程度のレスを生成してください。
- 各要素は {"no":2,"name":"名無しさん","mail":"sage","date":"2009/xx/xx(x) hh:mm:ss.xx","id":"${BOARD_ID_FORMAT_DESC}","body":"..."} の形にしてください。
- mail は原則 "sage" にしてください。本文で「sage」と言及する場合も、メール欄 mail に "sage" を入れてください。
- no は 2 から始まり、3以降は重複のないように連番（3, 4, 5...）にしてください。
- no: 2 は必ず本文取得不可の報告レスとし、no: 3以降はその反応レスとしてください。
- body 内の改行にはJSON文字列の \\n を使い、<br>などのHTMLタグは出力しないでください。

# 板ごとの住民設定
${input.residentPrompt?.trim() ? input.residentPrompt.trim() : "追加設定なし。"}

# スレ情報
スレタイ: ${input.threadTitle}
元記事タイトル: ${input.originalTitle}
URL: ${input.url}
記事日時: ${input.publishedAt || "不明"}`;
  }

  const bodyText = input.scrapedBody;

  return `# 目的
2000年代後半（2005年〜2009年頃）の日本語匿名掲示板の、一般ユーザー（掲示板の住民）によるレスの文体や雰囲気を再現してください。

# 必須要件（レスの役割分担と構成）
1. **レス番2 (no: 2) の役割**:
   - 記事の分野に詳しく、ソースを読んで要点を整理する「事情通の掲示板の住民」として書いてください。
   - >>2だけを読めば元記事を開かなくても内容を不足なく把握できる、自己完結した要約にしてください。短さより情報の網羅性を優先してください。
   - 記事から確認できる範囲で、何が起きたか・背景や目的・仕組みや手法・重要な仕様や数値・結果・実用上の影響・制約や注意点・今後について述べられていることを拾ってください。ただし、記事に存在しない項目を無理に作ったり、同じ内容を水増ししたりしないでください。
   - 結論だけでなく、読者が結論を理解するために必要な理由、比較対象、前提、具体例も省略しないでください。製品名、機能名、バージョン、期日、数値など、記事の理解に重要な固有情報は具体的に残してください。
   - 専門家を自称したり、記事にない背景を知ったかぶりしたりせず、元記事の情報と、そこから直接分かる読者への影響を伝えてください。
   - 記事の主題に合う観点と語彙を使ってください。元記事と無関係な分野の用語、比喩、専門家視点を持ち込まないでください。
   - 事実と感想を混同しないでください。記事にない詳細へわざわざ言及したり、要約の末尾に「まだ分からない」と定型的に付け足したりしないでください。不明点が記事の結論や読者の判断を左右する場合に限り、短く明示してください。
   - 最重要点を冒頭に置き、その後に根拠や詳細、影響、注意点を読みやすい順で続けてください。記事に複数の論点がある場合は、すべての主要論点を含めてください。
   - 箇条書きや短い段落、こまめな改行を記事に合わせて使い分けてください。情報量が多い場合は一文へ詰め込まず、読みやすく区切ってください。固定の見出しや定型文を毎回繰り返さないでください。
   - スレッド開始直後のレスなので、「今北産業」「今来た」など途中参加を示す表現は使わないでください。
   - 口調は堅い解説調や企業のプレスリリース調にしないでください。2005年〜2009年頃の匿名掲示板の住民が「ちょｗｗこれこういう話かよｗｗ」と面白がりながら説明するような、明るい勢い、草、驚き、ツッコミを自然に混ぜてください。
   - テンションは楽しく読める程度に高めてください。ただし、全行を草や絶叫で埋めず、記事情報の読みやすさと正確さを優先してください。
   - **>>3を煽る文言は入れないでください。**
2. **レス番3 (no: 3) 以降の役割**:
   - レス2 (no: 2) の情報整理をベースにして、住民たちが議論や雑談を交わす流れにしてください。
   - レス2に対して「情強きた」「なるほど」「それってつまり～ってこと？」「うはwwwwおkwwwwww」「夢が広がりングwwwwwwww」といった様々なリアクションを取り、議論を展開してください。

${BOARD_STYLE_RULES}

${BOARD_NG_RULES}

# 出力形式
- JSON配列だけを返してください。Markdownや説明文は禁止。
- 10個〜15個程度のレスを生成してください。
- 各要素は {"no":2,"name":"名無しさん","mail":"sage","date":"2009/xx/xx(x) hh:mm:ss.xx","id":"${BOARD_ID_FORMAT_DESC}","body":"..."} の形にしてください。
- mail は原則 "sage" にしてください。本文で「sage」と言及する場合も、メール欄 mail に "sage" を入れてください。
- no は 2 から始まり、3以降は重複のないように連番（3, 4, 5...）にしてください（例: 2, 3, 4, 5...）。
- no: 2 は必ず事情通の情報整理レスとし、no: 3以降はその議論レスとしてください。
- date は それっぽい日時にしてください。
- no: 2 の body は要約に必要な長さを確保してください。no: 3以降の body は短くし、いずれも改行を自然に含めてください。
- body 内の改行にはJSON文字列の \\n を使い、<br>などのHTMLタグは出力しないでください。

# 板ごとの住民設定
${input.residentPrompt?.trim() ? input.residentPrompt.trim() : "追加設定なし。標準的な2000年代後半（2005年〜2009年頃）の掲示板の住民として振る舞ってください。"}

# スレ情報
スレタイ: ${input.threadTitle}
元記事タイトル: ${input.originalTitle}
URL: ${input.url}
記事日時: ${input.publishedAt || "不明"}

# 情報ソース（記事要約・スクレイピング本文）
${bodyText}`;
}
