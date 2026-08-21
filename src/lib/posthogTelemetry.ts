import { hasDyadProKey, type UserSettings } from "@/lib/schemas";
import { DEFAULT_ENABLE_TESTING_FOR_NEW_APPS } from "@/shared/settings_defaults";

type TelemetryProperties = Record<string, unknown> | undefined;

const POSTHOG_ERROR_DEDUPE_STORAGE_KEY = "dyadPostHogErrorDedupe:v1";
const FREE_ERROR_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
const PRO_ERROR_DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const MAX_ERROR_DEDUPE_ENTRIES = 500;
const MAX_STORED_ENTRIES_TO_PARSE = MAX_ERROR_DEDUPE_ENTRIES * 2;

type TelemetryStorage = Pick<Storage, "getItem" | "setItem">;
type TelemetryStorageOwner = { readonly localStorage: TelemetryStorage };

type ErrorDedupeRecord = {
  lastSentAt: number;
  suppressedCount: number;
};

type ErrorDedupeState = Record<string, ErrorDedupeRecord>;

export type InitialLoadTelemetryInput = {
  settings: UserSettings;
  appVersion: string;
  platform: string | null;
  isFirstSession: boolean;
};

export function getSettingsPersonTelemetryProperties(settings: UserSettings) {
  return {
    isPro: hasDyadProKey(settings),
    enableAppBlueprint: settings.enableAppBlueprint ?? true,
    enableTestingForNewApps:
      settings.enableTestingForNewApps ?? DEFAULT_ENABLE_TESTING_FOR_NEW_APPS,
  };
}

export function getInitialLoadTelemetryProperties({
  settings,
  appVersion,
  platform,
  isFirstSession,
}: InitialLoadTelemetryInput) {
  return {
    ...getSettingsPersonTelemetryProperties(settings),
    appVersion,
    platform,
    releaseChannel: settings.releaseChannel,
    isFirstSession,
    modelProvider: settings.selectedModel.provider,
    defaultChatMode: settings.defaultChatMode ?? null,
    runtimeMode2: settings.runtimeMode2 ?? "host",
  };
}

/** PostHog event shape used by renderer `before_send` sampling. */
export type PostHogTelemetryEvent = {
  event?: string;
  properties?: TelemetryProperties;
};

/**
 * Best-effort, cross-window deduplication for PostHog error telemetry.
 *
 * Only hashes and counters are persisted. Raw exception messages, stack frames,
 * and custom error properties are used transiently to build the fingerprint.
 */
export class PostHogErrorDeduper {
  private memoryState: ErrorDedupeState = {};
  private storageAvailable: boolean;

  constructor(private readonly storage?: TelemetryStorage) {
    this.storageAvailable = Boolean(storage);
  }

  process<T extends PostHogTelemetryEvent | null | undefined>(
    event: T,
    isPro: boolean,
    now = Date.now(),
  ): T | null {
    if (!event) {
      return null;
    }
    const fingerprint = getErrorTelemetryFingerprint(event);
    if (!fingerprint) {
      return event;
    }

    const fingerprintHash = hashTelemetryFingerprint(fingerprint);
    const state = this.readState(now);
    const existing = state[fingerprintHash];
    const dedupeWindow = isPro
      ? PRO_ERROR_DEDUPE_WINDOW_MS
      : FREE_ERROR_DEDUPE_WINDOW_MS;

    if (
      existing &&
      now >= existing.lastSentAt &&
      now - existing.lastSentAt < dedupeWindow
    ) {
      state[fingerprintHash] = {
        ...existing,
        suppressedCount: Math.min(
          Number.MAX_SAFE_INTEGER,
          existing.suppressedCount + 1,
        ),
      };
      this.writeState(state);
      return null;
    }

    state[fingerprintHash] = { lastSentAt: now, suppressedCount: 0 };
    this.writeState(state);

    if (!existing?.suppressedCount) {
      return event;
    }

    return {
      ...event,
      properties: {
        ...event.properties,
        dyad_error_suppressed_count: existing.suppressedCount,
        dyad_error_suppression_duration_ms: Math.max(
          0,
          now - existing.lastSentAt,
        ),
      },
    } as T;
  }

  private readState(now: number): ErrorDedupeState {
    let candidate = this.memoryState;

    if (this.storage && this.storageAvailable) {
      try {
        const raw = this.storage.getItem(POSTHOG_ERROR_DEDUPE_STORAGE_KEY);
        if (raw) {
          candidate = parseErrorDedupeState(raw);
        }
      } catch {
        // localStorage can be unavailable in hardened/private environments.
      }
    }

    const entries = Object.entries(candidate)
      .filter(([, record]) => record.lastSentAt <= now)
      .sort(([, left], [, right]) => right.lastSentAt - left.lastSentAt)
      .slice(0, MAX_ERROR_DEDUPE_ENTRIES);

    this.memoryState = Object.fromEntries(entries);
    return { ...this.memoryState };
  }

  private writeState(state: ErrorDedupeState): void {
    const boundedState = Object.fromEntries(
      Object.entries(state)
        .sort(([, left], [, right]) => right.lastSentAt - left.lastSentAt)
        .slice(0, MAX_ERROR_DEDUPE_ENTRIES),
    );
    this.memoryState = boundedState;

    if (this.storage && this.storageAvailable) {
      try {
        this.storage.setItem(
          POSTHOG_ERROR_DEDUPE_STORAGE_KEY,
          JSON.stringify(boundedState),
        );
      } catch {
        // Continue deduplicating in memory when persistence is unavailable.
        this.storageAvailable = false;
      }
    }
  }
}

export function getPostHogTelemetryStorage(
  owner: TelemetryStorageOwner,
): TelemetryStorage | undefined {
  try {
    return owner.localStorage;
  } catch {
    return undefined;
  }
}

function parseErrorDedupeState(raw: string): ErrorDedupeState {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return {};
    }

    const validEntries: Array<[string, ErrorDedupeRecord]> = [];
    for (const [fingerprintHash, record] of Object.entries(parsed).slice(
      0,
      MAX_STORED_ENTRIES_TO_PARSE,
    )) {
      if (
        !/^[0-9a-f]{16}$/.test(fingerprintHash) ||
        !isRecord(record) ||
        typeof record.lastSentAt !== "number" ||
        !Number.isFinite(record.lastSentAt) ||
        typeof record.suppressedCount !== "number" ||
        !Number.isSafeInteger(record.suppressedCount) ||
        record.suppressedCount < 0
      ) {
        continue;
      }
      validEntries.push([
        fingerprintHash,
        {
          lastSentAt: record.lastSentAt,
          suppressedCount: record.suppressedCount,
        },
      ]);
    }
    return Object.fromEntries(validEntries);
  } catch {
    return {};
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPostHogErrorTelemetryEvent(
  event: PostHogTelemetryEvent | null | undefined,
): boolean {
  const eventName = event?.event;
  const properties = event?.properties;

  return (
    eventName === "$exception" ||
    eventName?.toLowerCase().includes("error") === true ||
    Array.isArray(properties?.$exception_list) ||
    typeof properties?.$exception_type === "string" ||
    typeof properties?.exception_name === "string" ||
    Boolean(properties?.error)
  );
}

export function isPostHogCrashTelemetryEvent(
  event: PostHogTelemetryEvent | null | undefined,
): boolean {
  return event?.event?.endsWith(":crash_detected") === true;
}

function getErrorTelemetryFingerprint(
  event: PostHogTelemetryEvent,
): string | null {
  if (
    !isPostHogErrorTelemetryEvent(event) ||
    isPostHogCrashTelemetryEvent(event)
  ) {
    return null;
  }

  const properties = event.properties;
  const exceptionList = Array.isArray(properties?.$exception_list)
    ? properties.$exception_list
    : [];
  const exceptionIdentity = exceptionList
    .map((exception) => normalizeException(exception))
    .filter(Boolean)
    .join("|caused-by|");

  const legacyIdentity = [
    normalizeTelemetryValue(properties?.$exception_type),
    normalizeTelemetryValue(properties?.$exception_message),
    normalizeTelemetryValue(properties?.exception_name),
    normalizeTelemetryValue(properties?.exception_message),
    normalizeTelemetryValue(properties?.exception_stack_trace),
  ]
    .filter(Boolean)
    .join("|");

  const customErrorIdentity = normalizeTelemetryValue(properties?.error);
  return [
    event.event ?? "<unnamed-error-event>",
    exceptionIdentity || legacyIdentity || customErrorIdentity,
  ].join("|");
}

function normalizeException(exception: unknown): string {
  if (!isRecord(exception)) {
    return normalizeTelemetryValue(exception);
  }

  const stacktrace = isRecord(exception.stacktrace)
    ? exception.stacktrace
    : undefined;
  const frames = Array.isArray(stacktrace?.frames) ? stacktrace.frames : [];
  const stableFrames = frames
    .slice(-5)
    .map((frame) => {
      if (!isRecord(frame)) {
        return normalizeTelemetryValue(frame);
      }
      return [
        normalizeStackFilename(frame.filename),
        normalizeTelemetryValue(frame.function),
        normalizeTelemetryValue(frame.module),
        normalizeStackCoordinate(frame.lineno),
        normalizeStackCoordinate(frame.colno),
      ]
        .filter(Boolean)
        .join(":");
    })
    .filter(Boolean)
    .join("|");

  return [
    normalizeTelemetryValue(exception.type),
    normalizeTelemetryValue(exception.value),
    stableFrames,
  ]
    .filter(Boolean)
    .join("|");
}

function normalizeStackCoordinate(value: unknown): string {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : "";
}

function normalizeStackFilename(value: unknown): string {
  if (typeof value !== "string") {
    return normalizeTelemetryValue(value);
  }

  const normalized = value.replaceAll("\\", "/").split(/[?#]/, 1)[0];
  const sourceMarker = normalized.lastIndexOf("/src/");
  if (sourceMarker >= 0) {
    return normalized.slice(sourceMarker + 1);
  }
  return normalized.split("/").slice(-3).join("/");
}

function normalizeTelemetryValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return normalizeVolatileText(value);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && Math.abs(value) < 100_000
      ? String(value)
      : "<number>";
  }
  if (typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (typeof value !== "object" || depth >= 3 || seen.has(value)) {
    return `<${typeof value}>`;
  }

  seen.add(value);
  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => normalizeTelemetryValue(item, depth + 1, seen))
      .join(",");
  }

  return Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, 20)
    .map(
      ([key, item]) =>
        `${key}:${normalizeTelemetryValue(item, depth + 1, seen)}`,
    )
    .join(",");
}

function normalizeVolatileText(value: string): string {
  return value
    .replace(
      /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gi,
      "<timestamp>",
    )
    .replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      "<uuid>",
    )
    .replace(/\b[0-9a-f]{16,}\b/gi, "<hex>")
    .replace(/\b\d{6,}\b/g, "<number>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2_000);
}

function hashTelemetryFingerprint(value: string): string {
  return `${hash32(value, 0x811c9dc5)}${hash32(value, 0x9e3779b9)}`;
}

function hash32(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Non-Pro telemetry sends only ~10% of events. These events are always sent.
 * Keep `sandbox.script.*` here so script instrumentation is never sampled out.
 */
/** Node/Electron undici network failure with no actionable stack context. */
export function isGenericFetchFailedError(
  name: string | undefined,
  message: string | undefined,
): boolean {
  return name === "TypeError" && message === "fetch failed";
}

export function shouldFilterPostHogExceptionEvent(
  event: PostHogTelemetryEvent | null | undefined,
): boolean {
  const properties = event?.properties;
  if (!properties) {
    return false;
  }

  if (
    isGenericFetchFailedError(
      typeof properties.exception_name === "string"
        ? properties.exception_name
        : undefined,
      typeof properties.exception_message === "string"
        ? properties.exception_message
        : undefined,
    )
  ) {
    return true;
  }

  return isGenericFetchFailedError(
    typeof properties.$exception_type === "string"
      ? properties.$exception_type
      : undefined,
    typeof properties.$exception_message === "string"
      ? properties.$exception_message
      : undefined,
  );
}

export function shouldBypassNonProTelemetrySampling(
  event: PostHogTelemetryEvent | null | undefined,
): boolean {
  const eventName = event?.event;

  if (eventName?.startsWith("sandbox.script.")) {
    return true;
  }

  if (eventName?.startsWith("pnpm:build-")) {
    return true;
  }

  if (eventName === "app:initial-load") {
    return true;
  }

  // PostHog people.set emits a $set event. Sampling it would leave person
  // properties stale even though the corresponding settings update succeeded.
  if (eventName === "$set") {
    return true;
  }

  // Promo clicks are only ever fired by non-Pro users; sampling would drop
  // 90% of them and make conversion funnels unreadable.
  if (eventName === "promo_click") {
    return true;
  }

  // Reporting a bug is rare enough that these add little volume, and sampling
  // them independently would break the outcome each prompt is paired with.
  if (
    eventName?.startsWith("screenshot-prompt:") ||
    eventName === "session-report:copy-session-id"
  ) {
    return true;
  }

  return isPostHogErrorTelemetryEvent(event);
}

export function createExceptionFromTelemetry(properties: TelemetryProperties) {
  const exception = new Error(
    typeof properties?.exception_message === "string"
      ? properties.exception_message
      : "Unknown IPC exception",
  );

  if (typeof properties?.exception_name === "string") {
    exception.name = properties.exception_name;
  }

  if (typeof properties?.exception_stack_trace === "string") {
    exception.stack = properties.exception_stack_trace;
  }

  return exception;
}

export function getExceptionTelemetryContext(properties: TelemetryProperties) {
  if (!properties) {
    return undefined;
  }

  const {
    exception_name: _exceptionName,
    exception_message: _exceptionMessage,
    exception_stack_trace: _exceptionStackTrace,
    ...context
  } = properties;

  return Object.keys(context).length > 0 ? context : undefined;
}
