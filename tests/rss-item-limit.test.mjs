import assert from "node:assert/strict";
import test from "node:test";

const {
  maxFeedItemsPerRefresh,
  selectRecentFeedItems
} = await import("../dist/main/rss/selectRecentFeedItems.js");
test("RSSは公開日時が新しいものから安全上限の最大500件を取り込む", () => {
  const items = Array.from({ length: 600 }, (_, index) => ({
    id: `item-${index}`,
    publishedAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString()
  })).reverse();

  const selected = selectRecentFeedItems(items);

  assert.equal(maxFeedItemsPerRefresh, 500);
  assert.equal(selected.length, 500);
  assert.equal(selected[0].id, "item-599");
  assert.equal(selected.at(-1).id, "item-100");
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
