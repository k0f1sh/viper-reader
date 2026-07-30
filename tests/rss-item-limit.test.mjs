import assert from "node:assert/strict";
import test from "node:test";

const {
  maxFeedItemsPerRefresh,
  selectRecentFeedItems
} = await import("../dist/main/rss/selectRecentFeedItems.js");
const {
  baselineTitleConversionsPerRefresh,
  selectTitleConversionItems
} = await import("../dist/main/rss/selectTitleConversionItems.js");

test("RSSは公開日時が新しいものから最大50件だけを取り込む", () => {
  const items = Array.from({ length: 60 }, (_, index) => ({
    id: `item-${index}`,
    publishedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString()
  })).reverse();

  const selected = selectRecentFeedItems(items);

  assert.equal(maxFeedItemsPerRefresh, 50);
  assert.equal(selected.length, 50);
  assert.equal(selected[0].id, "item-59");
  assert.equal(selected.at(-1).id, "item-10");
});

test("公開日時がない記事はRSS内の順序を保って末尾に置く", () => {
  const items = [
    { id: "undated-first", publishedAt: null },
    { id: "older", publishedAt: "2026-01-01T00:00:00.000Z" },
    { id: "newer", publishedAt: "2026-02-01T00:00:00.000Z" },
    { id: "undated-second", publishedAt: null }
  ];

  assert.deepEqual(
    selectRecentFeedItems(items, 4).map((item) => item.id),
    ["newer", "older", "undated-first", "undated-second"]
  );
});

test("新規取得した未変換記事は30件を超えても全件スレタイ変換する", () => {
  const items = Array.from({ length: 50 }, (_, index) => ({ id: `new-${index}` }));
  const result = selectTitleConversionItems(items, items.map((item) => item.id));

  assert.equal(baselineTitleConversionsPerRefresh, 30);
  assert.equal(result.items.length, 50);
  assert.equal(result.skippedCount, 0);
});

test("新規取得が30件未満なら以前の未変換記事を残り枠で回収する", () => {
  const newItems = Array.from({ length: 10 }, (_, index) => ({ id: `new-${index}` }));
  const backlog = Array.from({ length: 30 }, (_, index) => ({ id: `backlog-${index}` }));
  const result = selectTitleConversionItems(
    [...newItems, ...backlog],
    newItems.map((item) => item.id)
  );

  assert.deepEqual(result.items.slice(0, 10), newItems);
  assert.deepEqual(result.items.slice(10), backlog.slice(0, 20));
  assert.equal(result.skippedCount, 10);
});

test("既読記事は候補一覧に含まれない前提を崩さず新規IDだけを優先する", () => {
  const unreadItems = [{ id: "new-unread" }, { id: "old-unread" }];
  const result = selectTitleConversionItems(
    unreadItems,
    ["new-unread", "new-but-already-read"],
    1
  );

  assert.deepEqual(result.items, [{ id: "new-unread" }]);
  assert.equal(result.skippedCount, 1);
});
