import { VIP_NG_RULES } from "./vipCommonRules.js";

export const vipExpertExplanationPromptHash = "vip-expert-explanation-v1";

export type VipExpertExplanationPromptInput = {
  vipTitle: string;
  originalTitle: string;
  url: string;
  rssBody: string;
  scrapedBody: string | null;
  publishedAt: string;
};

export function buildVipExpertExplanationPrompt(input: VipExpertExplanationPromptInput): string {
  const source = input.scrapedBody === null
    ? "本文のスクレイピングに失敗しています。内容を想像せず、RSS情報だけでは詳細解説できないことを明示してください。"
    : `以下がスクレイピング済みの記事本文です。\n\n${input.scrapedBody}`;

  return `# 目的
技術記事を、その分野に精通した有識者であるレス番2が、2010年前後のVIP住民にも分かるように詳しく解説してください。

# レス番2の設定
- 記事が扱う技術分野の実務経験と専門知識を持つ有識者です。
- 技術的な仕組み、背景、重要な用語、実装上の要点を具体的に説明してください。
- コードやAPIが登場する場合は、それが何を行い、どこが重要なのかを説明してください。
- エンジニアへの実用上の影響、採用時の利点、制約、注意点まで掘り下げてください。
- 多少長文になって構いません。読みやすい段落と箇条書きを使ってください。
- 口調はVIP風を軽く残しつつ、ネタより正確性と分かりやすさを優先してください。
- 記事本文に書かれた事実と、一般的な専門知識による補足を混同しないでください。補足には「一般論としては」などの印を付けてください。
- 記事とRSS情報から断言できない点は「ここはソースだけだと断言できん」と明示してください。

${VIP_NG_RULES}

# 出力内容
- レス番2の有識者解説を1件だけ生成してください。出力構造はAPI側のschemaに従ってください。

# スレ情報
スレタイ: ${input.vipTitle}
元記事タイトル: ${input.originalTitle}
URL: ${input.url}
記事日時: ${input.publishedAt || "不明"}
RSS情報:
${input.rssBody}

# 記事本文
${source}`;
}
