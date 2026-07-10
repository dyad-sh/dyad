export interface SupabaseSharedFilesCacheValue<T> {
  signature: string;
  files: T[];
  byteSize: number;
}

interface CacheEntry<T> extends SupabaseSharedFilesCacheValue<T> {
  expiresAt: number;
}

export class SupabaseSharedFilesCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private totalBytes = 0;

  constructor(
    private readonly options: {
      maxBytes: number;
      maxEntries: number;
      ttlMs: number;
      now?: () => number;
    },
  ) {}

  get(
    sourceKey: string,
    signature: string,
  ): SupabaseSharedFilesCacheValue<T> | undefined {
    const now = this.now();
    this.pruneExpired(now);

    const cached = this.entries.get(sourceKey);
    if (!cached) {
      return;
    }

    if (cached.signature !== signature) {
      this.delete(sourceKey);
      return;
    }

    // Refresh both LRU order and the sliding TTL on a hit.
    this.entries.delete(sourceKey);
    cached.expiresAt = now + this.options.ttlMs;
    this.entries.set(sourceKey, cached);
    return cached;
  }

  set(
    sourceKey: string,
    value: SupabaseSharedFilesCacheValue<T>,
  ): SupabaseSharedFilesCacheValue<T> {
    this.pruneExpired(this.now());
    this.delete(sourceKey);

    // A payload may be deployable while still being too large to retain after
    // the request. Return it to the caller without rooting it in the cache.
    if (
      value.byteSize > this.options.maxBytes ||
      this.options.maxEntries === 0
    ) {
      return value;
    }

    while (
      this.entries.size >= this.options.maxEntries ||
      this.totalBytes + value.byteSize > this.options.maxBytes
    ) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) {
        break;
      }
      this.delete(oldestKey);
    }

    this.entries.set(sourceKey, {
      ...value,
      expiresAt: this.now() + this.options.ttlMs,
    });
    this.totalBytes += value.byteSize;
    return value;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  getStats(): { entries: number; totalBytes: number; keys: string[] } {
    this.pruneExpired(this.now());
    return {
      entries: this.entries.size,
      totalBytes: this.totalBytes,
      keys: Array.from(this.entries.keys()),
    };
  }

  private delete(sourceKey: string): void {
    const cached = this.entries.get(sourceKey);
    if (!cached) {
      return;
    }
    this.entries.delete(sourceKey);
    this.totalBytes -= cached.byteSize;
  }

  private pruneExpired(now: number): void {
    for (const [sourceKey, cached] of this.entries) {
      if (cached.expiresAt > now) {
        continue;
      }
      this.delete(sourceKey);
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
