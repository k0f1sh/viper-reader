type TitleConversionItem = {
  id: string;
};

export const baselineTitleConversionsPerRefresh = 30;

export function selectTitleConversionItems<T extends TitleConversionItem>(
  unconvertedItems: T[],
  insertedItemIds: string[],
  baselineLimit = baselineTitleConversionsPerRefresh
): {
  items: T[];
  skippedCount: number;
} {
  const insertedIds = new Set(insertedItemIds);
  const newlyInserted = unconvertedItems.filter((item) => insertedIds.has(item.id));
  const backlog = unconvertedItems.filter((item) => !insertedIds.has(item.id));
  const backlogLimit = Math.max(0, baselineLimit - newlyInserted.length);
  const selectedBacklog = backlog.slice(0, backlogLimit);

  return {
    items: [...newlyInserted, ...selectedBacklog],
    skippedCount: backlog.length - selectedBacklog.length
  };
}
