/**
 * MCP servers are external processes and their tool results are untrusted.
 * Keep a single result from being copied into the SDK, XML stream, renderer,
 * and persisted history at an unbounded size.
 */

export const MCP_RESULT_MAX_BYTES = 128 * 1024;

// Leave room for truncation metadata while keeping MCP_RESULT_MAX_BYTES as the
// only result limit.
const MCP_RESULT_CONTENT_BUDGET = MCP_RESULT_MAX_BYTES - 4 * 1024;
const TRUNCATION_KEY = "_dyadMcpTruncation";

type TruncationReason =
  | "byte-budget"
  | "binary-content"
  | "circular-reference"
  | "unreadable-property";

interface SanitizeState {
  omittedItems: number;
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

function sanitizeNode(
  input: unknown,
  state: SanitizeState,
  maxJsonBytes: number,
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
    return sanitizeNode(`${input.toString()}n`, state, maxJsonBytes);
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

  if (isBinary(input)) {
    markTruncated(state, "binary-content");
    return sanitizeNode(
      {
        _dyadOmittedBinary: {
          kind: input.constructor.name,
          bytes: binaryByteLength(input),
        },
      },
      state,
      maxJsonBytes,
    );
  }

  if (state.ancestors.has(input)) {
    markTruncated(state, "circular-reference");
    return sanitizeNode(
      "[omitted: circular MCP result reference]",
      state,
      maxJsonBytes,
    );
  }

  state.ancestors.add(input);
  try {
    if (Array.isArray(input)) {
      const result: unknown[] = [];
      let bytes = 2;
      for (let index = 0; index < input.length; index += 1) {
        const separatorBytes = result.length > 0 ? 1 : 0;
        const remaining = maxJsonBytes - bytes - separatorBytes;
        if (remaining < 4) {
          state.omittedItems += input.length - index;
          markTruncated(state, "byte-budget");
          break;
        }
        const child = sanitizeNode(input[index], state, remaining);
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
        const separatorBytes = includedProperties > 0 ? 1 : 0;
        const keyBudget = maxJsonBytes - bytes - separatorBytes - 1;
        const keyResult = takeJsonStringPrefix(key, Math.max(2, keyBudget));
        if (keyResult.truncated) {
          state.omittedItems += 1;
          markTruncated(state, "byte-budget");
          break;
        }
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
          propertyValue = inputRecord[key];
        } catch {
          propertyValue = "[omitted: unreadable MCP result property]";
          markTruncated(state, "unreadable-property");
        }
        const child = sanitizeNode(propertyValue, state, remaining);
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
    limits: { maxBytes: MCP_RESULT_MAX_BYTES },
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
    omittedItems: 0,
    reasons: new Set(),
    ancestors: new WeakSet(),
  };
  const node = sanitizeNode(input, state, MCP_RESULT_CONTENT_BUDGET);
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
