/**
 * Gemini API の responseSchema として渡す JSON スキーマ定義。
 *
 * responseSchema は生成支援であり、保存前の防衛的 validation は引き続き各 generator で行う。
 * mail フィールドは空文字や undefined があり得るため、validator 側で normalize する。
 */

/**
 * スレッドレス配列のスキーマ。
 * threadResponseGenerator と replyGenerator で共通して使う。
 */
export const threadPostArraySchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      no: { type: "integer" },
      name: { type: "string" },
      mail: { type: "string" },
      date: { type: "string" },
      id: { type: "string" },
      speakerKey: { type: "string" },
      body: { type: "string" }
    },
    required: ["no", "name", "date", "id", "body"]
  }
} as const;

export const expertThreadPostArraySchema = {
  type: "array",
  description: "レス番2による有識者解説を1件だけ格納する配列",
  minItems: "1",
  maxItems: "1",
  items: {
    type: "object",
    properties: {
      no: { type: "integer", description: "レス番号。常に2", minimum: 2, maximum: 2 },
      name: { type: "string", description: "2ちゃんねる風の投稿者名", maxLength: "80" },
      mail: { type: "string", description: "メール欄。原則sage", maxLength: "20" },
      date: { type: "string", description: "2010年前後の2ちゃんねる風日時", maxLength: "40" },
      id: { type: "string", description: "8桁のランダムな英数字", pattern: "^[A-Za-z0-9]{8}$" },
      body: { type: "string", description: "専門家による詳しく正確な解説本文。段落や箇条書きの区切りには実際の改行を入れる", maxLength: "6000" }
    },
    required: ["no", "name", "mail", "date", "id", "body"]
  }
} as const;

/**
 * VIPスレタイ変換結果配列のスキーマ。
 * titleTransformer で使う。
 */
export const vipTitleArraySchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      feedItemId: { type: "string" },
      vipTitle: { type: "string" }
    },
    required: ["feedItemId", "vipTitle"]
  }
} as const;
