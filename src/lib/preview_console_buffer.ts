import type { ConsoleEntry } from "@/ipc/types";

// Keep the renderer's long-lived preview history small enough that a noisy dev
// server cannot exhaust the renderer heap. The main-process log store has its
// own policy and intentionally remains independent from this UI buffer.
export const MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP = 1_000;
export const MAX_PREVIEW_CONSOLE_BYTES_PER_APP = 2 * 1024 * 1024;
export const MAX_PREVIEW_CONSOLE_MESSAGE_BYTES = 64 * 1024;
export const MAX_PREVIEW_CONSOLE_SOURCE_NAME_BYTES = 1_024;

export const PREVIEW_CONSOLE_OMISSION_MESSAGE =
  "… [older preview logs omitted to stay within the console memory limit]";

const MESSAGE_TRUNCATION_SUFFIX = "\n… [log payload truncated]";
const SOURCE_NAME_TRUNCATION_SUFFIX = "… [source truncated]";
const OMISSION_MARKER_SOURCE = "Dyad";
const MAX_FORMATTED_ARGUMENTS = 20;
const MAX_FORMATTED_ARGUMENT_BYTES = 8 * 1024;
const FORWARDED_ARGUMENT_OMISSION_PATTERN = /^… \[\d+ arguments omitted\]$/;
const CONSOLE_OMISSION_MARKER_FIELD = "__dyadConsoleOmissionMarker";

type BufferedConsoleEntry = ConsoleEntry & {
  [CONSOLE_OMISSION_MARKER_FIELD]?: true;
};

interface BoundedUtf8String {
  value: string;
  byteLength: number;
}

function utf8CodePointByteLength(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

/**
 * Measures and, when necessary, truncates without first allocating a full
 * UTF-8 copy of an attacker-controlled string.
 */
export function boundUtf8String(
  value: string,
  maxBytes: number,
  truncationSuffix: string,
): BoundedUtf8String {
  if (maxBytes <= 0) {
    return { value: "", byteLength: 0 };
  }

  let byteLength = 0;
  let prefixByteLength = 0;
  let prefixEnd = 0;
  const suffixByteLength = getUtf8ByteLength(truncationSuffix);
  const prefixLimit = Math.max(0, maxBytes - suffixByteLength);

  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index) ?? 0;
    const codeUnitLength = codePoint > 0xffff ? 2 : 1;
    const codePointByteLength = utf8CodePointByteLength(codePoint);
    const nextIndex = index + codeUnitLength;

    byteLength += codePointByteLength;
    if (byteLength <= prefixLimit) {
      prefixEnd = nextIndex;
      prefixByteLength = byteLength;
    }

    if (byteLength > maxBytes) {
      if (suffixByteLength > maxBytes) {
        let boundedSuffixByteLength = 0;
        let suffixEnd = 0;

        for (let suffixIndex = 0; suffixIndex < truncationSuffix.length; ) {
          const suffixCodePoint =
            truncationSuffix.codePointAt(suffixIndex) ?? 0;
          const codeUnitLength = suffixCodePoint > 0xffff ? 2 : 1;
          const nextByteLength =
            boundedSuffixByteLength + utf8CodePointByteLength(suffixCodePoint);
          if (nextByteLength > maxBytes) break;
          boundedSuffixByteLength = nextByteLength;
          suffixIndex += codeUnitLength;
          suffixEnd = suffixIndex;
        }

        return {
          value: truncationSuffix.slice(0, suffixEnd),
          byteLength: boundedSuffixByteLength,
        };
      }

      return {
        value: value.slice(0, prefixEnd) + truncationSuffix,
        byteLength: prefixByteLength + suffixByteLength,
      };
    }

    index = nextIndex;
  }

  return { value, byteLength };
}

export function getUtf8ByteLength(value: string): number {
  let byteLength = 0;
  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index) ?? 0;
    byteLength += utf8CodePointByteLength(codePoint);
    index += codePoint > 0xffff ? 2 : 1;
  }
  return byteLength;
}

export function getPreviewConsoleEntryByteLength(entry: ConsoleEntry): number {
  return (
    getUtf8ByteLength(entry.message) +
    (entry.sourceName ? getUtf8ByteLength(entry.sourceName) : 0)
  );
}

export function boundPreviewConsoleEntry(
  entry: ConsoleEntry,
  appId = entry.appId,
): ConsoleEntry {
  const message = boundUtf8String(
    entry.message,
    MAX_PREVIEW_CONSOLE_MESSAGE_BYTES,
    MESSAGE_TRUNCATION_SUFFIX,
  ).value;
  const sourceName = entry.sourceName
    ? boundUtf8String(
        entry.sourceName,
        MAX_PREVIEW_CONSOLE_SOURCE_NAME_BYTES,
        SOURCE_NAME_TRUNCATION_SUFFIX,
      ).value
    : undefined;

  if (
    message === entry.message &&
    sourceName === entry.sourceName &&
    appId === entry.appId
  ) {
    return entry;
  }

  return { ...entry, appId, message, sourceName };
}

export function formatPreviewConsoleMessage(
  prefix: string,
  values: readonly unknown[],
): string {
  const boundedPrefix = boundUtf8String(
    prefix,
    MAX_FORMATTED_ARGUMENT_BYTES,
    MESSAGE_TRUNCATION_SUFFIX,
  ).value;
  const formattedValues: string[] = [];
  const lastValue = values.at(-1);
  const forwardedOmissionMarker =
    typeof lastValue === "string" &&
    FORWARDED_ARGUMENT_OMISSION_PATTERN.test(lastValue)
      ? lastValue
      : undefined;
  const candidateValueCount = values.length - (forwardedOmissionMarker ? 1 : 0);
  const valueCount = Math.min(candidateValueCount, MAX_FORMATTED_ARGUMENTS);

  for (let index = 0; index < valueCount; index++) {
    const value = values[index];
    let stringValue: string;
    try {
      stringValue = typeof value === "string" ? value : String(value);
    } catch {
      stringValue = "[unable to format console value]";
    }
    formattedValues.push(
      boundUtf8String(
        stringValue,
        MAX_FORMATTED_ARGUMENT_BYTES,
        MESSAGE_TRUNCATION_SUFFIX,
      ).value,
    );
  }

  if (candidateValueCount > valueCount) {
    formattedValues.push(
      `… [${candidateValueCount - valueCount} values omitted]`,
    );
  } else if (forwardedOmissionMarker) {
    formattedValues.push(forwardedOmissionMarker);
  }

  return boundUtf8String(
    [boundedPrefix, ...formattedValues].filter(Boolean).join(" "),
    MAX_PREVIEW_CONSOLE_MESSAGE_BYTES,
    MESSAGE_TRUNCATION_SUFFIX,
  ).value;
}

export function formatPreviewNetworkStatus(status: unknown): string {
  return typeof status === "number" ? `[${status}]` : "[unknown status]";
}

function isOmissionMarker(entry: ConsoleEntry): boolean {
  return (
    (entry as BufferedConsoleEntry)[CONSOLE_OMISSION_MARKER_FIELD] === true
  );
}

function createOmissionMarker(
  appId: number,
  oldestRetainedEntry: ConsoleEntry,
): BufferedConsoleEntry {
  return {
    appId,
    level: "warn",
    type: "server",
    message: PREVIEW_CONSOLE_OMISSION_MESSAGE,
    sourceName: OMISSION_MARKER_SOURCE,
    timestamp: oldestRetainedEntry.timestamp,
    [CONSOLE_OMISSION_MARKER_FIELD]: true,
  };
}

/**
 * Builds a chronological, newest-first-selected tail without materializing an
 * unbounded concatenation. Incoming entries are inspected from newest to
 * oldest, so an oversized batch never causes its discarded prefix to be
 * normalized or copied.
 */
export function createPreviewConsoleTail(
  appId: number,
  existingEntries: readonly ConsoleEntry[],
  incomingEntries: readonly ConsoleEntry[],
): ConsoleEntry[] {
  const retainedNewestFirst: ConsoleEntry[] = [];
  let retainedBytes = 0;
  let omittedEntries = false;
  let reachedLimit = false;

  const retain = (rawEntry: ConsoleEntry): boolean => {
    if (isOmissionMarker(rawEntry)) {
      omittedEntries = true;
      return true;
    }

    const entry = boundPreviewConsoleEntry(rawEntry, appId);
    const entryBytes = getPreviewConsoleEntryByteLength(entry);
    if (
      retainedNewestFirst.length >= MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP ||
      retainedBytes + entryBytes > MAX_PREVIEW_CONSOLE_BYTES_PER_APP
    ) {
      omittedEntries = true;
      reachedLimit = true;
      return false;
    }

    retainedNewestFirst.push(entry);
    retainedBytes += entryBytes;
    return true;
  };

  for (let index = incomingEntries.length - 1; index >= 0; index--) {
    if (!retain(incomingEntries[index])) break;
  }

  if (!reachedLimit) {
    for (let index = existingEntries.length - 1; index >= 0; index--) {
      if (!retain(existingEntries[index])) break;
    }
  }

  if (omittedEntries && retainedNewestFirst.length > 0) {
    const markerForSizing = createOmissionMarker(
      appId,
      retainedNewestFirst[retainedNewestFirst.length - 1],
    );
    const markerBytes = getPreviewConsoleEntryByteLength(markerForSizing);

    // The marker is part of both budgets. Remove the oldest retained entries
    // until it fits, while always preserving the newest useful log.
    while (
      retainedNewestFirst.length > 1 &&
      (retainedNewestFirst.length + 1 > MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP ||
        retainedBytes + markerBytes > MAX_PREVIEW_CONSOLE_BYTES_PER_APP)
    ) {
      const removed = retainedNewestFirst.pop();
      if (removed) {
        retainedBytes -= getPreviewConsoleEntryByteLength(removed);
      }
    }

    // Build the marker after trimming so its timestamp matches the actual
    // oldest retained entry. Keep the final guard even though the current
    // per-entry limit is smaller than the aggregate byte budget: it preserves
    // both invariants if those constants change independently in the future.
    if (
      retainedNewestFirst.length + 1 <= MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP &&
      retainedBytes + markerBytes <= MAX_PREVIEW_CONSOLE_BYTES_PER_APP
    ) {
      retainedNewestFirst.push(
        createOmissionMarker(
          appId,
          retainedNewestFirst[retainedNewestFirst.length - 1],
        ),
      );
    }
  }

  retainedNewestFirst.reverse();
  return retainedNewestFirst;
}
