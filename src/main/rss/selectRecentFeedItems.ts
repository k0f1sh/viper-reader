export const maxFeedItemsPerRefresh = 500;

type FeedItemWithPublishedAt = {
  publishedAt: string | null;
};

export function selectRecentFeedItems<T extends FeedItemWithPublishedAt>(
  items: T[],
  limit = maxFeedItemsPerRefresh
): T[] {
  return items
    .map((item, index) => ({
      item,
      index,
      publishedAtMs: item.publishedAt ? Date.parse(item.publishedAt) : Number.NaN
    }))
    .sort((left, right) => {
      const leftHasDate = Number.isFinite(left.publishedAtMs);
      const rightHasDate = Number.isFinite(right.publishedAtMs);
      if (leftHasDate && rightHasDate && left.publishedAtMs !== right.publishedAtMs) {
        return right.publishedAtMs - left.publishedAtMs;
      }
      if (leftHasDate !== rightHasDate) {
        return leftHasDate ? -1 : 1;
      }
      return left.index - right.index;
    })
    .slice(0, limit)
    .map(({ item }) => item);
}
