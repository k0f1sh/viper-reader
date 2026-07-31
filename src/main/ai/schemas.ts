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

/**
 * 匿名掲示板スレタイ変換結果配列のスキーマ。
 * titleTransformer で使う。
 */
export const threadTitleArraySchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      feedItemId: { type: "string" },
      threadTitle: { type: "string" }
    },
    required: ["feedItemId", "threadTitle"]
  }
} as const;
