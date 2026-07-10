/**
 * MCP servers are external processes and their tool results are untrusted.
 * Keep a single result from being copied into the SDK, XML stream, renderer,
 * and persisted history at an unbounded size.
 */

export const MCP_RESULT_MAX_BYTES = 64 * 1024;
export const MCP_RESULT_MAX_ITEMS = 100;
export const MCP_RESULT_MAX_MEDIA_ITEMS = 4;
export const MCP_RESULT_MAX_EMBEDDED_MEDIA_BYTES = 16 * 1024;
export const MCP_RESULT_MAX_DEPTH = 12;

const MCP_RESULT_CONTENT_BUDGET = 60 * 1024;
const TRUNCATION_KEY = "_dyadMcpTruncation";
const BASE64_PROPERTY_NAMES = new Set(["base64", "blob", "data"]);

type TruncationReason =
  | "byte-budget"
  | "depth-limit"
  | "item-limit"
  | "media-byte-limit"
  | "media-item-limit"
  | "binary-content"
  | "circular-reference"
  | "unreadable-property";

interface SanitizeState {
  itemCount: number;
  mediaItemCount: number;
  omittedItems: number;
  omittedMediaItems: number;
  reasons: Set<TruncationReason>;
  ancestors: WeakSet<object>;
}

interface SanitizedNode {
  value: unknown;
  jsonBytes: number;
}

export interface SanitizedMcpResult {
  /** A JSON-safe, bounded value suitable for returning to sandbox scripts. */
  value: unknown;
  /** Bounded text suitable for the model, XML output, and persistence. */
  serialized: string;
  truncated: boolean;
}

interface MediaContent {
  type: "image" | "audio";
  data: string;
  mimeType?: unknown;
}

interface BlobResourceContent {
  type: "resource";
  resource: Record<string, unknown> & { blob: string };
}

function utf8ByteLengthForCodePoint(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function jsonByteLengthForCharacter(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (character === '"' || character === "\\") return 2;
  if (
    character === "\b" ||
    character === "\t" ||
    character === "\n" ||
    character === "\f" ||
    character === "\r"
  ) {
    return 2;
  }
  // JSON.stringify escapes the other control characters and lone surrogates.
  if (codePoint <= 0x1f || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
    return 6;
  }
  return utf8ByteLengthForCodePoint(codePoint);
}

function takeJsonStringPrefix(
  input: string,
  maxJsonBytes: number,
): { value: string; jsonBytes: number; truncated: boolean } {
  // Account for the surrounding JSON quotes.
  if (maxJsonBytes < 2) {
    return { value: "", jsonBytes: 2, truncated: input.length > 0 };
  }

  let jsonBytes = 2;
  let end = 0;
  for (const character of input) {
    const nextBytes = jsonByteLengthForCharacter(character);
    if (jsonBytes + nextBytes > maxJsonBytes) break;
    jsonBytes += nextBytes;
    end += character.length;
  }

  return {
    value: input.slice(0, end),
    jsonBytes,
    truncated: end < input.length,
  };
}

function takeUtf8Prefix(
  input: string,
  maxBytes: number,
): { value: string; bytes: number; truncated: boolean } {
  let bytes = 0;
  let end = 0;
  for (const character of input) {
    const codePoint = character.codePointAt(0) ?? 0;
    const nextBytes = utf8ByteLengthForCodePoint(codePoint);
    if (bytes + nextBytes > maxBytes) break;
    bytes += nextBytes;
    end += character.length;
  }
  return {
    value: input.slice(0, end),
    bytes,
    truncated: end < input.length,
  };
}

function approximateDecodedBase64Bytes(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((data.length * 3) / 4) - padding);
}

function approximateDecodedBase64PayloadBytes(
  payloadLength: number,
  source: string,
): number {
  const padding = source.endsWith("==") ? 2 : source.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payloadLength * 3) / 4) - padding);
}

function getBase64PayloadLength(value: string): number | undefined {
  const dataUrlMarker = ";base64,";
  const dataUrlMarkerIndex = value.startsWith("data:")
    ? value.indexOf(dataUrlMarker, 5)
    : -1;
  if (dataUrlMarkerIndex !== -1 && dataUrlMarkerIndex < 512) {
    return value.length - dataUrlMarkerIndex - dataUrlMarker.length;
  }
  if (value.length < 4) return undefined;
  const firstSample = value.slice(0, Math.min(128, value.length));
  const lastSample = value.slice(Math.max(0, value.length - 128));
  const base64Characters = /^[A-Za-z0-9+/_=-]+$/;
  return base64Characters.test(firstSample) && base64Characters.test(lastSample)
    ? value.length
    : undefined;
}

function isMediaContent(value: object): value is MediaContent {
  const record = value as Record<string, unknown>;
  return (
    (record.type === "image" || record.type === "audio") &&
    typeof record.data === "string"
  );
}

function isBlobResourceContent(value: object): value is BlobResourceContent {
  const record = value as Record<string, unknown>;
  if (record.type !== "resource" || !isObject(record.resource)) return false;
  return typeof record.resource.blob === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBinary(value: unknown): value is ArrayBufferView | ArrayBuffer {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function binaryByteLength(value: ArrayBufferView | ArrayBuffer): number {
  return value.byteLength;
}

function markTruncated(state: SanitizeState, reason: TruncationReason): void {
  state.reasons.add(reason);
}

function createMediaSummary(params: {
  kind: string;
  byteLength: number;
  mimeType?: unknown;
  reason: "media-byte-limit" | "media-item-limit";
}): Record<string, unknown> {
  return {
    omitted: true,
    kind: params.kind,
    ...(typeof params.mimeType === "string"
      ? { mimeType: params.mimeType }
      : {}),
    approximateBytes: params.byteLength,
    reason: params.reason,
  };
}

function replaceLargeEmbeddedMedia(
  value: object,
  state: SanitizeState,
): object | undefined {
  if (!isMediaContent(value) && !isBlobResourceContent(value)) {
    return undefined;
  }

  const nextMediaItemCount = state.mediaItemCount + 1;
  const exceedsItemLimit = nextMediaItemCount > MCP_RESULT_MAX_MEDIA_ITEMS;
  const data = isMediaContent(value) ? value.data : value.resource.blob;
  const decodedBytes = approximateDecodedBase64Bytes(data);
  const exceedsByteLimit = decodedBytes > MCP_RESULT_MAX_EMBEDDED_MEDIA_BYTES;
  state.mediaItemCount = nextMediaItemCount;
  if (!exceedsItemLimit && !exceedsByteLimit) {
    // The explicit MCP media shape is enough to count this item. The generic
    // data/blob path only removes oversized payloads, so ordinary structured
    // strings cannot consume the media item budget.
    return undefined;
  }

  const reason = exceedsItemLimit ? "media-item-limit" : "media-byte-limit";
  markTruncated(state, reason);
  state.omittedMediaItems += 1;

  if (isMediaContent(value)) {
    return {
      type: value.type,
      data: "",
      ...(typeof value.mimeType === "string"
        ? { mimeType: value.mimeType }
        : {}),
      _dyadOmittedMedia: createMediaSummary({
        kind: value.type,
        byteLength: decodedBytes,
        mimeType: value.mimeType,
        reason,
      }),
    };
  }

  return {
    type: "resource",
    resource: {
      ...(typeof value.resource.uri === "string"
        ? { uri: value.resource.uri }
        : {}),
      ...(typeof value.resource.name === "string"
        ? { name: value.resource.name }
        : {}),
      ...(typeof value.resource.title === "string"
        ? { title: value.resource.title }
        : {}),
      ...(typeof value.resource.description === "string"
        ? { description: value.resource.description }
        : {}),
      ...(typeof value.resource.mimeType === "string"
        ? { mimeType: value.resource.mimeType }
        : {}),
      ...(typeof value.resource.size === "number"
        ? { size: value.resource.size }
        : {}),
      blob: "",
      _dyadOmittedMedia: createMediaSummary({
        kind: "resource-blob",
        byteLength: decodedBytes,
        mimeType: value.resource.mimeType,
        reason,
      }),
    },
  };
}

function replaceLargeBase64Property(
  key: string,
  value: unknown,
  state: SanitizeState,
): unknown {
  if (typeof value !== "string") return value;
  const normalizedKey = key.toLowerCase();
  if (!BASE64_PROPERTY_NAMES.has(normalizedKey)) return value;
  const payloadLength = getBase64PayloadLength(value);
  if (payloadLength === undefined) return value;

  const decodedBytes = approximateDecodedBase64PayloadBytes(
    payloadLength,
    value,
  );
  // Generic data/blob/base64 keys are common in ordinary structured output.
  // Only treat them as media when the payload is independently large enough
  // to violate the embedded-media byte limit. Explicit MCP media shapes are
  // counted by replaceLargeEmbeddedMedia instead.
  if (decodedBytes <= MCP_RESULT_MAX_EMBEDDED_MEDIA_BYTES) {
    return value;
  }

  state.mediaItemCount += 1;
  const exceedsItemLimit = state.mediaItemCount > MCP_RESULT_MAX_MEDIA_ITEMS;
  const reason = exceedsItemLimit ? "media-item-limit" : "media-byte-limit";
  markTruncated(state, reason);
  state.omittedMediaItems += 1;
  return {
    _dyadOmittedMedia: createMediaSummary({
      kind: normalizedKey,
      byteLength: decodedBytes,
      reason,
    }),
  };
}

function hasOmittedMediaMarker(value: Record<string, unknown>): boolean {
  if (Object.prototype.hasOwnProperty.call(value, "_dyadOmittedMedia")) {
    return true;
  }
  return (
    value.type === "resource" &&
    isObject(value.resource) &&
    Object.prototype.hasOwnProperty.call(value.resource, "_dyadOmittedMedia")
  );
}

function sanitizeNode(
  input: unknown,
  state: SanitizeState,
  maxJsonBytes: number,
  depth: number,
): SanitizedNode {
  if (input === null) return { value: null, jsonBytes: 4 };
  if (typeof input === "boolean") {
    return { value: input, jsonBytes: input ? 4 : 5 };
  }
  if (typeof input === "number") {
    const value = Number.isFinite(input) ? input : null;
    const serialized = JSON.stringify(value);
    return { value, jsonBytes: Buffer.byteLength(serialized, "utf8") };
  }
  if (typeof input === "bigint") {
    return sanitizeNode(`${input.toString()}n`, state, maxJsonBytes, depth);
  }
  if (typeof input === "string") {
    const prefix = takeJsonStringPrefix(input, Math.max(2, maxJsonBytes));
    if (prefix.truncated) markTruncated(state, "byte-budget");
    return { value: prefix.value, jsonBytes: prefix.jsonBytes };
  }
  if (
    typeof input === "undefined" ||
    typeof input === "symbol" ||
    typeof input === "function"
  ) {
    return { value: null, jsonBytes: 4 };
  }

  if (depth >= MCP_RESULT_MAX_DEPTH) {
    markTruncated(state, "depth-limit");
    return sanitizeNode(
      "[omitted: MCP result depth limit reached]",
      state,
      maxJsonBytes,
      depth,
    );
  }

  if (isBinary(input)) {
    markTruncated(state, "binary-content");
    state.omittedMediaItems += 1;
    return sanitizeNode(
      {
        _dyadOmittedBinary: {
          kind: input.constructor.name,
          bytes: binaryByteLength(input),
        },
      },
      state,
      maxJsonBytes,
      depth + 1,
    );
  }

  if (state.ancestors.has(input)) {
    markTruncated(state, "circular-reference");
    return sanitizeNode(
      "[omitted: circular MCP result reference]",
      state,
      maxJsonBytes,
      depth,
    );
  }

  const mediaReplacement = hasOmittedMediaMarker(
    input as Record<string, unknown>,
  )
    ? undefined
    : replaceLargeEmbeddedMedia(input, state);
  if (mediaReplacement) {
    return sanitizeNode(mediaReplacement, state, maxJsonBytes, depth);
  }

  state.ancestors.add(input);
  try {
    if (Array.isArray(input)) {
      const result: unknown[] = [];
      let bytes = 2;
      for (let index = 0; index < input.length; index += 1) {
        if (state.itemCount >= MCP_RESULT_MAX_ITEMS) {
          state.omittedItems += input.length - index;
          markTruncated(state, "item-limit");
          break;
        }
        const separatorBytes = result.length > 0 ? 1 : 0;
        const remaining = maxJsonBytes - bytes - separatorBytes;
        if (remaining < 4) {
          state.omittedItems += input.length - index;
          markTruncated(state, "byte-budget");
          break;
        }
        state.itemCount += 1;
        const child = sanitizeNode(input[index], state, remaining, depth + 1);
        if (child.jsonBytes > remaining) {
          state.omittedItems += input.length - index;
          markTruncated(state, "byte-budget");
          break;
        }
        result.push(child.value);
        bytes += separatorBytes + child.jsonBytes;
      }
      return { value: result, jsonBytes: bytes };
    }

    const result: Record<string, unknown> = {};
    const inputRecord = input as Record<string, unknown>;
    let bytes = 2;
    let includedProperties = 0;
    try {
      for (const key in inputRecord) {
        if (!Object.prototype.hasOwnProperty.call(inputRecord, key)) continue;
        if (state.itemCount >= MCP_RESULT_MAX_ITEMS) {
          state.omittedItems += 1;
          markTruncated(state, "item-limit");
          break;
        }
        // Count every visited own property, including keys that cannot be
        // retained. Otherwise an attacker can bypass the traversal bound with
        // an arbitrary number of overlong keys.
        state.itemCount += 1;

        const keyResult = takeJsonStringPrefix(key, 512);
        if (keyResult.truncated) {
          state.omittedItems += 1;
          markTruncated(state, "byte-budget");
          continue;
        }
        const separatorBytes = includedProperties > 0 ? 1 : 0;
        const propertyOverhead =
          separatorBytes + keyResult.jsonBytes + 1 /* colon */;
        const remaining = maxJsonBytes - bytes - propertyOverhead;
        if (remaining < 4) {
          state.omittedItems += 1;
          markTruncated(state, "byte-budget");
          break;
        }

        let propertyValue: unknown;
        try {
          propertyValue = replaceLargeBase64Property(
            key,
            inputRecord[key],
            state,
          );
        } catch {
          propertyValue = "[omitted: unreadable MCP result property]";
          markTruncated(state, "unreadable-property");
        }
        const child = sanitizeNode(propertyValue, state, remaining, depth + 1);
        if (child.jsonBytes > remaining) {
          state.omittedItems += 1;
          markTruncated(state, "byte-budget");
          break;
        }
        Object.defineProperty(result, keyResult.value, {
          value: child.value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
        includedProperties += 1;
        bytes += propertyOverhead + child.jsonBytes;
      }
    } catch {
      markTruncated(state, "unreadable-property");
      result._dyadUnreadableResult = true;
      bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
    }
    return { value: result, jsonBytes: bytes };
  } finally {
    state.ancestors.delete(input);
  }
}

function buildTruncationMetadata(state: SanitizeState) {
  return {
    truncated: true,
    reasons: [...state.reasons].sort(),
    omittedItems: state.omittedItems,
    omittedMediaItems: state.omittedMediaItems,
    limits: {
      maxBytes: MCP_RESULT_MAX_BYTES,
      maxItems: MCP_RESULT_MAX_ITEMS,
      maxMediaItems: MCP_RESULT_MAX_MEDIA_ITEMS,
      maxEmbeddedMediaBytes: MCP_RESULT_MAX_EMBEDDED_MEDIA_BYTES,
      maxDepth: MCP_RESULT_MAX_DEPTH,
    },
  };
}

function attachTruncationMetadata(
  value: unknown,
  state: SanitizeState,
): unknown {
  const metadata = buildTruncationMetadata(state);
  if (typeof value === "string") {
    return `${value}\n[Dyad truncated MCP result: ${metadata.reasons.join(", ")}]`;
  }
  if (Array.isArray(value)) {
    value.push({ [TRUNCATION_KEY]: metadata });
    return value;
  }
  if (isObject(value)) {
    value[TRUNCATION_KEY] = metadata;
    return value;
  }
  return { value, [TRUNCATION_KEY]: metadata };
}

function createBoundedFallback(serialized: string): SanitizedMcpResult {
  const metadata = {
    truncated: true,
    reasons: ["byte-budget"],
    limits: { maxBytes: MCP_RESULT_MAX_BYTES },
  };
  // JSON escaping can grow a preview by up to six bytes per input byte. Use a
  // conservative prefix and shrink if a future metadata change grows it.
  let previewBytes = Math.floor((MCP_RESULT_MAX_BYTES - 1024) / 6);
  let value: Record<string, unknown>;
  let output: string;
  do {
    const preview = takeUtf8Prefix(serialized, previewBytes).value;
    value = { preview, [TRUNCATION_KEY]: metadata };
    output = JSON.stringify(value);
    previewBytes = Math.floor(previewBytes * 0.75);
  } while (
    Buffer.byteLength(output, "utf8") > MCP_RESULT_MAX_BYTES &&
    previewBytes > 0
  );
  return { value, serialized: output, truncated: true };
}

/**
 * Convert an arbitrary MCP result into bounded JSON-safe data without first
 * stringifying the untrusted result. The returned text never exceeds the hard
 * UTF-8 byte limit and truncation is explicit to both scripts and the model.
 */
export function sanitizeMcpToolResult(input: unknown): SanitizedMcpResult {
  const state: SanitizeState = {
    itemCount: 0,
    mediaItemCount: 0,
    omittedItems: 0,
    omittedMediaItems: 0,
    reasons: new Set(),
    ancestors: new WeakSet(),
  };
  const node = sanitizeNode(input, state, MCP_RESULT_CONTENT_BUDGET, 0);
  const truncated = state.reasons.size > 0;
  const value = truncated
    ? attachTruncationMetadata(node.value, state)
    : node.value;
  const serialized =
    typeof value === "string" ? value : JSON.stringify(value ?? null);

  if (Buffer.byteLength(serialized, "utf8") > MCP_RESULT_MAX_BYTES) {
    return createBoundedFallback(serialized);
  }

  return { value, serialized, truncated };
}
