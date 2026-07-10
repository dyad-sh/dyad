export interface IndexCacheEntryStats {
  key: string;
  lastUsedAt: number;
  bytes: number;
}

export interface EvictionPlanInput {
  /** Cached index entries, excluding the key about to be (re)built. */
  entries: IndexCacheEntryStats[];
  /** Measured `v8.getHeapStatistics().used_heap_size` after a GC. */
  usedHeapBytes: number;
  /** Heap budget the cache must fit under before a build starts. */
  budgetBytes: number;
  /** Maximum cache entries INCLUDING the incoming index. */
  maxEntries: number;
}

/**
 * Decide which cached indexes to evict before building a new one, LRU first.
 *
 * Eviction is planned against the measured total used heap rather than the
 * sum of per-entry estimates: per-entry `bytes` (GC'd heap delta across that
 * entry's build) can under-count shared structures, but the total heap cannot
 * lie, so we keep evicting until the projected heap fits the budget. A
 * secondary count cap bounds many-tiny-projects metadata accumulation.
 *
 * Returns the keys to evict, least-recently-used first. May return every
 * entry when even that cannot reach the budget (e.g. the process baseline
 * alone exceeds it); the build then proceeds with an empty cache.
 */
export function evictionPlan({
  entries,
  usedHeapBytes,
  budgetBytes,
  maxEntries,
}: EvictionPlanInput): string[] {
  const lruFirst = [...entries].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
  const evict: string[] = [];
  let projectedUsedBytes = usedHeapBytes;
  let remainingEntries = lruFirst.length;
  for (const entry of lruFirst) {
    const overBudget = projectedUsedBytes > budgetBytes;
    // The incoming index adds one entry, so leave room for it.
    const overCount = remainingEntries + 1 > maxEntries;
    if (!overBudget && !overCount) {
      break;
    }
    evict.push(entry.key);
    projectedUsedBytes -= entry.bytes;
    remainingEntries -= 1;
  }
  return evict;
}
