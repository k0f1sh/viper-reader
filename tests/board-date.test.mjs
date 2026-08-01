import assert from "node:assert/strict";
import test from "node:test";

const { createSequentialBoardDates, formatBoardDate } = await import("../dist/main/threads/boardDate.js");

test("掲示板日時は実際の曜日と百分の一秒を表示する", () => {
  const date = new Date(2026, 7, 1, 12, 34, 56, 789);
  assert.equal(formatBoardDate(date), "2026/08/01(土) 12:34:56.78");
});

test("生成レスの日時は基準となる現在時刻からレス順に進む", () => {
  const base = new Date(2026, 7, 1, 12, 34, 56, 0);
  assert.deepEqual(createSequentialBoardDates(3, base), [
    "2026/08/01(土) 12:34:56.00",
    "2026/08/01(土) 12:34:57.00",
    "2026/08/01(土) 12:34:58.00"
  ]);
});
