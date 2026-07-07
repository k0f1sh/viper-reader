const lockedThreadIds = new Set<string>();

export function acquireThreadLock(threadId: string): boolean {
  if (lockedThreadIds.has(threadId)) {
    return false;
  }

  lockedThreadIds.add(threadId);
  return true;
}

export function releaseThreadLock(threadId: string): void {
  lockedThreadIds.delete(threadId);
}
