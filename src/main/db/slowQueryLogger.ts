import { performance } from "node:perf_hooks";

const defaultSlowQueryThresholdMs = 20;

export function runWithSlowQueryLog<T>(label: string, query: () => T): T {
  const startedAt = performance.now();
  try {
    return query();
  } finally {
    const elapsedMs = performance.now() - startedAt;
    const thresholdMs = getSlowQueryThresholdMs();
    if (elapsedMs >= thresholdMs) {
      console.warn(`[Slow DB] ${label}: ${elapsedMs.toFixed(1)}ms (threshold: ${thresholdMs}ms)`);
    }
  }
}

function getSlowQueryThresholdMs(): number {
  const rawThreshold = process.env.VIPER_READER_SLOW_QUERY_MS;
  const configured = rawThreshold === undefined || rawThreshold.trim() === ""
    ? Number.NaN
    : Number(rawThreshold);
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : defaultSlowQueryThresholdMs;
}
