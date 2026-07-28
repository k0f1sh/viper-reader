const activeRefreshes = new Map<string, Promise<unknown>>();

export function runFeedRefreshSingleFlight<T>(
  feedId: string,
  task: () => Promise<T>
): Promise<T> {
  const active = activeRefreshes.get(feedId) as Promise<T> | undefined;
  if (active) {
    return active;
  }

  const refresh = task().finally(() => {
    if (activeRefreshes.get(feedId) === refresh) {
      activeRefreshes.delete(feedId);
    }
  });
  activeRefreshes.set(feedId, refresh);
  return refresh;
}
