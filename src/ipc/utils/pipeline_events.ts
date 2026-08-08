/**
 * The typed event bus behind the Live AI Pipeline viewer, and the sanitiser
 * every event passes through before it reaches a screen, a log file or an
 * export.
 *
 * A diagnostics panel is an unusual feature: its whole purpose is to show what
 * the application is doing, which makes it the most likely place for a secret
 * to escape. An API key in a header, a bearer token in a URL, the system
 * prompt, the user's private memories — all of it flows past this code every
 * turn. So sanitising is not a filter applied at the edge; it is the only way
 * an event can be constructed, and there is deliberately no path around it.
 *
 * The second constraint is that watching must not slow anything down. The
 * buffer is bounded, producers never block, and nothing large is serialised on
 * the inference path.
 */

import crypto from "node:crypto";

export type PipelineCategory =
  | "chat"
  | "embedding"
  | "memory"
  | "qdrant"
  | "files"
  | "jobs"
  | "health"
  | "error";

export type PipelineStatus = "started" | "progress" | "completed" | "failed";

export type PipelineEvent = {
  id: string;
  timestamp: string;
  category: PipelineCategory;
  operation: string;
  status: PipelineStatus;
  /** Shared by every event belonging to one user interaction. */
  correlationId?: string;
  conversationId?: string;
  jobId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

// ── Sanitising ─────────────────────────────────────────────────────────────

/**
 * Key names whose values are never shown, whatever they contain.
 *
 * Matched as substrings and case-insensitively, so `X-Api-Key`, `apiKey` and
 * `refresh_token` are all caught without needing to be listed.
 */
const SECRET_KEYS = [
  "authorization",
  "api-key",
  "api_key",
  "apikey",
  "access-token",
  "access_token",
  "refresh-token",
  "refresh_token",
  "token",
  "password",
  "secret",
  "cookie",
  "session",
  "credential",
];

/**
 * Fields that are not secrets but must never be surfaced: the system prompt,
 * developer instructions, and any reasoning the model was asked to keep to
 * itself. Showing these in a diagnostics panel would leak them into logs and
 * exports where they do not belong.
 */
const NEVER_SHOWN_KEYS = [
  "systemprompt",
  "system_prompt",
  "developerprompt",
  "developer_prompt",
  "chainofthought",
  "chain_of_thought",
  "reasoning",
  "thinking",
  "hiddenreasoning",
  "rawmemory",
  "memorycontent",
];

export const REDACTED = "[redacted]";
export const WITHHELD = "[withheld]";

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[\s-]/g, "_");
}

function isSecretKey(key: string): boolean {
  const normalised = key.toLowerCase();
  return SECRET_KEYS.some(
    (candidate) =>
      normalised.includes(candidate.replace(/[-_]/g, "")) ||
      normalised.includes(candidate),
  );
}

function isNeverShown(key: string): boolean {
  const normalised = normaliseKey(key).replace(/_/g, "");
  return NEVER_SHOWN_KEYS.some(
    (candidate) => normalised === candidate.replace(/_/g, ""),
  );
}

/**
 * Strips credentials out of a URL, keeping enough to identify the endpoint.
 *
 * Local endpoints routinely carry a key in the query string, and the host and
 * path are the useful part for diagnosis anyway.
 */
export function sanitiseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      url.username = REDACTED;
      url.password = "";
    }
    for (const key of [...url.searchParams.keys()]) {
      if (isSecretKey(key)) url.searchParams.set(key, REDACTED);
    }
    return url.toString();
  } catch {
    // Not a URL; fall back to masking anything that looks like a key.
    return value.replace(/\b[A-Za-z0-9_-]{24,}\b/g, REDACTED);
  }
}

const MAX_STRING = 300;
const MAX_DEPTH = 6;

/**
 * Recursively cleans a value for display.
 *
 * Nested objects are the realistic case — a request's `headers.Authorization`
 * is two levels down — so this walks the whole structure rather than checking
 * only top-level keys.
 */
export function sanitiseValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "[truncated]";
  if (value == null) return value;

  if (typeof value === "string") {
    const cleaned = /^https?:\/\//i.test(value) ? sanitiseUrl(value) : value;
    return cleaned.length > MAX_STRING
      ? `${cleaned.slice(0, MAX_STRING)}… (${cleaned.length} chars)`
      : cleaned;
  }

  if (typeof value === "number" || typeof value === "boolean") return value;

  if (Array.isArray(value)) {
    // Long arrays are summarised rather than dumped.
    const capped = value
      .slice(0, 20)
      .map((item) => sanitiseValue(item, depth + 1));
    return value.length > 20
      ? [...capped, `… ${value.length - 20} more`]
      : capped;
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as object)) {
      if (isSecretKey(key)) {
        output[key] = REDACTED;
      } else if (isNeverShown(key)) {
        output[key] = WITHHELD;
      } else {
        output[key] = sanitiseValue(nested, depth + 1);
      }
    }
    return output;
  }

  return String(value);
}

export function sanitiseMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  return sanitiseValue(metadata) as Record<string, unknown>;
}

// ── The bus ────────────────────────────────────────────────────────────────

export type EventListener = (event: PipelineEvent) => void;

export type EmitInput = Omit<PipelineEvent, "id" | "timestamp"> & {
  id?: string;
  timestamp?: string;
};

/**
 * A bounded ring of recent events with subscribers.
 *
 * Bounded because a diagnostics buffer that grows with traffic becomes a leak
 * in a long session; subscribers are wrapped so one throwing listener cannot
 * take down the producer, which is on the chat path.
 */
export class PipelineEventBus {
  private readonly events: PipelineEvent[] = [];
  private readonly listeners = new Set<EventListener>();

  constructor(private readonly capacity = 500) {}

  emit(input: EmitInput): PipelineEvent {
    const event: PipelineEvent = {
      id: input.id ?? crypto.randomUUID(),
      timestamp: input.timestamp ?? new Date().toISOString(),
      category: input.category,
      operation: input.operation,
      status: input.status,
      correlationId: input.correlationId,
      conversationId: input.conversationId,
      jobId: input.jobId,
      durationMs: input.durationMs,
      // Sanitising happens here, on the only path that constructs an event.
      metadata: sanitiseMetadata(input.metadata),
    };

    this.events.push(event);
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity);
    }

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A broken viewer must never break the pipeline it is watching.
      }
    }
    return event;
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Recent events, oldest first. */
  recent(limit = 200): PipelineEvent[] {
    return this.events.slice(-limit);
  }

  /** Everything belonging to one user interaction, in order. */
  byCorrelation(correlationId: string): PipelineEvent[] {
    return this.events.filter((event) => event.correlationId === correlationId);
  }

  /** Clears the view. Persistent logs and memory are untouched. */
  clear(): void {
    this.events.length = 0;
  }

  get size(): number {
    return this.events.length;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

export const pipelineEvents = new PipelineEventBus();

/** A fresh id for one user interaction, threaded through every stage. */
export function newCorrelationId(): string {
  return `req-${crypto.randomUUID().slice(0, 12)}`;
}

/**
 * Aggregates streaming progress.
 *
 * One event per token would flood the bus and slow the very thing it watches,
 * so progress is reported at most this often.
 */
export class ProgressSampler {
  private lastEmit = 0;

  constructor(private readonly intervalMs = 250) {}

  shouldEmit(now = Date.now()): boolean {
    if (now - this.lastEmit < this.intervalMs) return false;
    this.lastEmit = now;
    return true;
  }
}
