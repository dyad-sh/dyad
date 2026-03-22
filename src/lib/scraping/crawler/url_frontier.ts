/**
 * URL Frontier — Priority queue with Bloom filter deduplication.
 *
 * Provides O(1) membership testing for URLs already visited and a
 * priority queue for the crawl frontier. Backed by SQLite for resume.
 */

import log from "electron-log";

const logger = log.scope("scraping:url-frontier");

/**
 * Simple Bloom filter implementation for URL deduplication.
 * Uses multiple hash functions for low false-positive rate.
 */
export class BloomFilter {
  private bits: Uint8Array;
  private size: number;
  private hashCount: number;

  constructor(expectedItems: number, falsePositiveRate = 0.001) {
    // Calculate optimal filter size: m = -n*ln(p) / (ln(2))^2
    this.size = Math.ceil(
      (-expectedItems * Math.log(falsePositiveRate)) / (Math.LN2 * Math.LN2),
    );
    // Calculate optimal hash count: k = (m/n) * ln(2)
    this.hashCount = Math.ceil((this.size / expectedItems) * Math.LN2);
    this.bits = new Uint8Array(Math.ceil(this.size / 8));
  }

  private hash(str: string, seed: number): number {
    let h = seed;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) >>> 0;
    }
    return h % this.size;
  }

  add(item: string): void {
    for (let i = 0; i < this.hashCount; i++) {
      const bit = this.hash(item, i * 0x9e3779b9);
      this.bits[bit >>> 3] |= 1 << (bit & 7);
    }
  }

  has(item: string): boolean {
    for (let i = 0; i < this.hashCount; i++) {
      const bit = this.hash(item, i * 0x9e3779b9);
      if (!(this.bits[bit >>> 3] & (1 << (bit & 7)))) return false;
    }
    return true;
  }

  get count(): number {
    let set = 0;
    for (let i = 0; i < this.bits.length; i++) {
      let byte = this.bits[i];
      while (byte) {
        set += byte & 1;
        byte >>= 1;
      }
    }
    // Estimate: n ≈ -(m/k) * ln(1 - X/m)
    return Math.round(
      -(this.size / this.hashCount) * Math.log(1 - set / this.size),
    );
  }
}

// ── Priority Queue ──────────────────────────────────────────────────────────

interface QueueEntry {
  url: string;
  depth: number;
  priority: number;
  parentUrl?: string;
}

/**
 * Min-heap priority queue for URL frontier management.
 * Lower priority number = higher priority.
 */
export class PriorityQueue {
  private heap: QueueEntry[] = [];

  get size(): number {
    return this.heap.length;
  }

  push(entry: QueueEntry): void {
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): QueueEntry | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  peek(): QueueEntry | undefined {
    return this.heap[0];
  }

  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parent = (idx - 1) >>> 1;
      if (this.heap[parent].priority <= this.heap[idx].priority) break;
      [this.heap[parent], this.heap[idx]] = [this.heap[idx], this.heap[parent]];
      idx = parent;
    }
  }

  private sinkDown(idx: number): void {
    const len = this.heap.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < len && this.heap[left].priority < this.heap[smallest].priority)
        smallest = left;
      if (right < len && this.heap[right].priority < this.heap[smallest].priority)
        smallest = right;
      if (smallest === idx) break;
      [this.heap[smallest], this.heap[idx]] = [this.heap[idx], this.heap[smallest]];
      idx = smallest;
    }
  }
}

// ── URL Frontier ────────────────────────────────────────────────────────────

export class UrlFrontier {
  private bloom: BloomFilter;
  private queue: PriorityQueue;
  private visitedCount = 0;

  constructor(expectedUrls = 100_000) {
    this.bloom = new BloomFilter(expectedUrls);
    this.queue = new PriorityQueue();
  }

  /**
   * Add a URL to the frontier if not already visited.
   * Returns true if the URL was added, false if already seen.
   */
  add(url: string, depth: number, priority = 0, parentUrl?: string): boolean {
    const normalized = this.normalizeUrl(url);
    if (this.bloom.has(normalized)) return false;

    this.bloom.add(normalized);
    this.queue.push({ url: normalized, depth, priority, parentUrl });
    return true;
  }

  /**
   * Get the next URL to crawl.
   */
  next(): QueueEntry | undefined {
    const entry = this.queue.pop();
    if (entry) this.visitedCount++;
    return entry;
  }

  /**
   * Mark a URL as visited without adding to queue.
   */
  markVisited(url: string): void {
    this.bloom.add(this.normalizeUrl(url));
    this.visitedCount++;
  }

  /**
   * Check if URL has been seen.
   */
  hasSeen(url: string): boolean {
    return this.bloom.has(this.normalizeUrl(url));
  }

  get queueSize(): number {
    return this.queue.size;
  }

  get totalVisited(): number {
    return this.visitedCount;
  }

  /**
   * Normalize URL for deduplication.
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove trailing slash, hash, and sort query params
      parsed.hash = "";
      const params = new URLSearchParams(parsed.searchParams);
      params.sort();
      parsed.search = params.toString() ? `?${params.toString()}` : "";
      let normalized = parsed.href;
      if (normalized.endsWith("/") && parsed.pathname !== "/") {
        normalized = normalized.slice(0, -1);
      }
      return normalized.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }
}
