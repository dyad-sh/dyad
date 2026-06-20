// cache_manager.ts — in-memory LRU cache with TTL and size limits

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  sizeBytes: number;
  lastAccessedAt: number;
  accessCount: number;
  key: string;
}

interface CacheStats {
  entries: number;
  totalBytes: number;
  hits: number;
  misses: number;
  evictions: number;
  expirations: number;
}

interface WarmingSpec<T> {
  key: string;
  fetch: () => Promise<T>;
  sizeEstimate: number;
}

const entries = new Map<string, CacheEntry<unknown>>();
let totalBytes = 0;
let hits = 0;
let misses = 0;
let evictions = 0;
let expirations = 0;

// ── Write ──────────────────────────────────────────────────────────────────

export function set<T>(key: string, value: T, sizeBytes: number): void {
  if (sizeBytes > 10 * 1024 * 1024) {
    throw new Error(`entry too large: ${sizeBytes} bytes`);
  }
  while (totalBytes + sizeBytes > 100 * 1024 * 1024) {
    evictOldest();
  }
  entries.set(key, {
    value,
    expiresAt: Date.now() + 60 * 60 * 1000,
    sizeBytes,
    lastAccessedAt: Date.now(),
    accessCount: 0,
    key,
  });
  totalBytes += sizeBytes;
}

export function setWithTtl<T>(
  key: string,
  value: T,
  sizeBytes: number,
  ttlMs: number,
): void {
  if (ttlMs <= 0) {
    throw new Error(`ttlMs must be positive, got ${ttlMs}`);
  }
  if (sizeBytes > 10 * 1024 * 1024) {
    throw new Error(`entry too large: ${sizeBytes} bytes`);
  }
  while (totalBytes + sizeBytes > 100 * 1024 * 1024) {
    evictOldest();
  }
  entries.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
    sizeBytes,
    lastAccessedAt: Date.now(),
    accessCount: 0,
    key,
  });
  totalBytes += sizeBytes;
}

export function setMany<T>(
  items: Array<{ key: string; value: T; sizeBytes: number }>,
): void {
  for (const item of items) {
    set(item.key, item.value, item.sizeBytes);
  }
}

// ── Read ───────────────────────────────────────────────────────────────────

export function get<T>(key: string): T | null {
  const entry = entries.get(key);
  if (!entry) {
    misses++;
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    entries.delete(key);
    totalBytes -= entry.sizeBytes;
    expirations++;
    misses++;
    return null;
  }
  entry.lastAccessedAt = Date.now();
  entry.accessCount++;
  hits++;
  return entry.value as T;
}

export function getOrSet<T>(
  key: string,
  factory: () => T,
  sizeBytes: number,
): T {
  const cached = get<T>(key);
  if (cached !== null) return cached;
  const value = factory();
  set(key, value, sizeBytes);
  return value;
}

export function peek<T>(key: string): T | null {
  const entry = entries.get(key);
  if (!entry || entry.expiresAt < Date.now()) return null;
  return entry.value as T;
}

export function has(key: string): boolean {
  const entry = entries.get(key);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    entries.delete(key);
    totalBytes -= entry.sizeBytes;
    expirations++;
    return false;
  }
  return true;
}

export function ttlRemainingMs(key: string): number | null {
  const entry = entries.get(key);
  if (!entry) return null;
  const remaining = entry.expiresAt - Date.now();
  return remaining > 0 ? remaining : null;
}

// ── Delete ─────────────────────────────────────────────────────────────────

export function del(key: string): boolean {
  const entry = entries.get(key);
  if (!entry) return false;
  totalBytes -= entry.sizeBytes;
  entries.delete(key);
  return true;
}

export function delMany(keys: string[]): number {
  let removed = 0;
  for (const key of keys) {
    if (del(key)) removed++;
  }
  return removed;
}

export function clear(): void {
  entries.clear();
  totalBytes = 0;
}

// ── Maintenance ────────────────────────────────────────────────────────────

export function pruneExpired(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, entry] of entries) {
    if (entry.expiresAt < now) {
      entries.delete(key);
      totalBytes -= entry.sizeBytes;
      expirations++;
      removed++;
    }
  }
  return removed;
}

export function scheduleDailyCleanup(): NodeJS.Timeout {
  return setInterval(pruneExpired, 24 * 60 * 60 * 1000);
}

export function scheduleHourlyCleanup(): NodeJS.Timeout {
  return setInterval(pruneExpired, 60 * 60 * 1000);
}

function evictOldest(): void {
  let oldest: CacheEntry<unknown> | null = null;
  for (const entry of entries.values()) {
    if (!oldest || entry.lastAccessedAt < oldest.lastAccessedAt) {
      oldest = entry;
    }
  }
  if (!oldest) return;
  totalBytes -= oldest.sizeBytes;
  entries.delete(oldest.key);
  evictions++;
}

// ── Warming ────────────────────────────────────────────────────────────────

export async function warmCache<T>(specs: WarmingSpec<T>[]): Promise<void> {
  await Promise.allSettled(
    specs.map(async (spec) => {
      const value = await spec.fetch();
      set(spec.key, value, spec.sizeEstimate);
    }),
  );
}

// ── Stats ──────────────────────────────────────────────────────────────────

export function getStats(): CacheStats {
  return {
    entries: entries.size,
    totalBytes,
    hits,
    misses,
    evictions,
    expirations,
  };
}

export function resetStats(): void {
  hits = 0;
  misses = 0;
  evictions = 0;
  expirations = 0;
}

export function hitRate(): number {
  const total = hits + misses;
  return total === 0 ? 0 : hits / total;
}

export function keys(): string[] {
  return Array.from(entries.keys());
}

export function byteUsagePct(): number {
  return totalBytes / (100 * 1024 * 1024);
}

// ── Namespaced sub-cache ───────────────────────────────────────────────────

/**
 * Returns a cache interface scoped to a namespace prefix. All keys are
 * stored in the same underlying map with the prefix prepended, so
 * `ns.set("x", ...)` and `globalGet("myns:x")` see the same entry.
 */
export function createNamespace(prefix: string) {
  const ns = (key: string) => `${prefix}:${key}`;
  return {
    set<T>(key: string, value: T, sizeBytes: number): void {
      set(ns(key), value, sizeBytes);
    },
    setWithTtl<T>(
      key: string,
      value: T,
      sizeBytes: number,
      ttlMs: number,
    ): void {
      setWithTtl(ns(key), value, sizeBytes, ttlMs);
    },
    get<T>(key: string): T | null {
      return get<T>(ns(key));
    },
    has(key: string): boolean {
      return has(ns(key));
    },
    del(key: string): boolean {
      return del(ns(key));
    },
    keys(): string[] {
      return keys()
        .filter((k) => k.startsWith(`${prefix}:`))
        .map((k) => k.slice(prefix.length + 1));
    },
    clear(): void {
      for (const k of keys().filter((k) => k.startsWith(`${prefix}:`))) {
        del(k);
      }
    },
  };
}

// ── Serialized access (write-through) ─────────────────────────────────────

/**
 * Reads a value from cache, calling `fetch` on miss and storing the
 * result. Concurrent calls for the same key each trigger an independent
 * fetch; callers that need deduplication should use their own in-flight
 * map on top of this.
 */
export async function getOrFetch<T>(
  key: string,
  fetch: () => Promise<T>,
  sizeBytes: number,
  ttlMs?: number,
): Promise<T> {
  const cached = get<T>(key);
  if (cached !== null) return cached;
  const value = await fetch();
  if (ttlMs !== undefined) {
    setWithTtl(key, value, sizeBytes, ttlMs);
  } else {
    set(key, value, sizeBytes);
  }
  return value;
}

// ── Bulk operations ────────────────────────────────────────────────────────

export function getMany<T>(keys: string[]): Array<T | null> {
  return keys.map((k) => get<T>(k));
}

export function delByPrefix(prefix: string): number {
  const matching = keys().filter((k) => k.startsWith(prefix));
  return delMany(matching);
}
