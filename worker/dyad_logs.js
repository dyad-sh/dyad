/**
 * dyad_logs.js – Console interception script
 * Intercepts all console methods and forwards them to the parent window
 */

(function () {
  const MAX_ARGUMENTS = 10;
  const MAX_ARGUMENT_BYTES = 8 * 1024;
  const MAX_STRING_VALUE_BYTES = 4 * 1024;
  const MAX_OBJECT_DEPTH = 4;
  const MAX_OBJECT_KEYS = 20;
  const MAX_OBJECT_KEY_BYTES = 256;
  const MAX_SERIALIZED_NODES = 100;
  const VALUE_TRUNCATION_SUFFIX = "… [console value truncated]";

  // Store original console methods
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;
  const originalInfo = console.info;
  const originalDebug = console.debug;

  function utf8CodePointByteLength(codePoint) {
    if (codePoint <= 0x7f) return 1;
    if (codePoint <= 0x7ff) return 2;
    if (codePoint <= 0xffff) return 3;
    return 4;
  }

  function utf8ByteLength(value) {
    let byteLength = 0;
    for (let index = 0; index < value.length; ) {
      const codePoint = value.codePointAt(index) ?? 0;
      byteLength += utf8CodePointByteLength(codePoint);
      index += codePoint > 0xffff ? 2 : 1;
    }
    return byteLength;
  }

  function truncateUtf8(value, maxBytes) {
    if (maxBytes <= 0) return "";

    let byteLength = 0;
    let prefixEnd = 0;
    const suffixByteLength = utf8ByteLength(VALUE_TRUNCATION_SUFFIX);
    const prefixLimit = Math.max(0, maxBytes - suffixByteLength);

    for (let index = 0; index < value.length; ) {
      const codePoint = value.codePointAt(index) ?? 0;
      const nextIndex = index + (codePoint > 0xffff ? 2 : 1);
      byteLength += utf8CodePointByteLength(codePoint);
      if (byteLength <= prefixLimit) prefixEnd = nextIndex;
      if (byteLength > maxBytes) {
        if (suffixByteLength > maxBytes) {
          let suffixEnd = 0;
          let usedBytes = 0;
          for (
            let suffixIndex = 0;
            suffixIndex < VALUE_TRUNCATION_SUFFIX.length;
          ) {
            const suffixCodePoint =
              VALUE_TRUNCATION_SUFFIX.codePointAt(suffixIndex) ?? 0;
            const nextSuffixIndex =
              suffixIndex + (suffixCodePoint > 0xffff ? 2 : 1);
            const nextBytes =
              usedBytes + utf8CodePointByteLength(suffixCodePoint);
            if (nextBytes > maxBytes) break;
            usedBytes = nextBytes;
            suffixEnd = nextSuffixIndex;
            suffixIndex = nextSuffixIndex;
          }
          return VALUE_TRUNCATION_SUFFIX.slice(0, suffixEnd);
        }
        return value.slice(0, prefixEnd) + VALUE_TRUNCATION_SUFFIX;
      }
      index = nextIndex;
    }

    return value;
  }

  function takeStringWithinBudget(value, state, maxBytes) {
    const availableBytes = Math.min(maxBytes, state.remainingBytes);
    const boundedValue = truncateUtf8(value, availableBytes);
    state.remainingBytes = Math.max(
      0,
      state.remainingBytes - utf8ByteLength(boundedValue),
    );
    return boundedValue;
  }

  function sanitizeValue(value, state, depth) {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
      return takeStringWithinBudget(value, state, MAX_STRING_VALUE_BYTES);
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    if (typeof value === "bigint") {
      return takeStringWithinBudget(`${value}n`, state, MAX_STRING_VALUE_BYTES);
    }
    if (typeof value === "function") {
      return takeStringWithinBudget(
        `[Function ${value.name || "anonymous"}]`,
        state,
        MAX_OBJECT_KEY_BYTES,
      );
    }
    if (typeof value === "symbol") {
      return takeStringWithinBudget(
        String(value),
        state,
        MAX_STRING_VALUE_BYTES,
      );
    }
    if (state.remainingBytes <= 0) return "";
    if (depth >= MAX_OBJECT_DEPTH) {
      return takeStringWithinBudget(
        "[Maximum log depth reached]",
        state,
        MAX_STRING_VALUE_BYTES,
      );
    }
    if (state.remainingNodes <= 0) {
      return takeStringWithinBudget(
        "[Log value node limit reached]",
        state,
        MAX_STRING_VALUE_BYTES,
      );
    }
    if (state.seen.has(value)) {
      return takeStringWithinBudget(
        "[Circular]",
        state,
        MAX_STRING_VALUE_BYTES,
      );
    }

    state.remainingNodes--;
    state.seen.add(value);

    // Match JSON.stringify semantics for built-ins such as Date and URL while
    // retaining the traversal and byte limits for the value returned by
    // user-defined toJSON implementations.
    try {
      if (typeof value.toJSON === "function") {
        const jsonValue = value.toJSON();
        if (jsonValue !== value) {
          return sanitizeValue(jsonValue, state, depth);
        }
      }
    } catch {
      // Fall back to bounded property serialization when toJSON throws.
    }

    if (value instanceof Error) {
      return {
        name: takeStringWithinBudget(
          String(value.name),
          state,
          MAX_STRING_VALUE_BYTES,
        ),
        message: takeStringWithinBudget(
          String(value.message),
          state,
          MAX_STRING_VALUE_BYTES,
        ),
        stack: takeStringWithinBudget(
          String(value.stack ?? ""),
          state,
          MAX_STRING_VALUE_BYTES,
        ),
      };
    }

    if (Array.isArray(value)) {
      const itemCount = Math.min(
        value.length,
        MAX_OBJECT_KEYS,
        state.remainingNodes,
      );
      const result = [];
      let index = 0;
      for (; index < itemCount && state.remainingBytes > 0; index++) {
        result.push(sanitizeValue(value[index], state, depth + 1));
      }
      if (index < value.length && state.remainingBytes > 0) {
        result.push(
          takeStringWithinBudget(
            `… [${value.length - index} array items omitted]`,
            state,
            MAX_STRING_VALUE_BYTES,
          ),
        );
      }
      return result;
    }

    const result = {};
    let includedKeys = 0;
    let hasMoreKeys = false;
    try {
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (
          includedKeys >= MAX_OBJECT_KEYS ||
          state.remainingNodes <= 0 ||
          state.remainingBytes <= 0
        ) {
          hasMoreKeys = true;
          break;
        }
        includedKeys++;
        const safeKey = takeStringWithinBudget(
          key,
          state,
          MAX_OBJECT_KEY_BYTES,
        );
        if (!safeKey) {
          hasMoreKeys = true;
          break;
        }
        try {
          result[safeKey] = sanitizeValue(value[key], state, depth + 1);
        } catch {
          result[safeKey] = takeStringWithinBudget(
            "[Unable to read property]",
            state,
            MAX_STRING_VALUE_BYTES,
          );
        }
      }
    } catch {
      return takeStringWithinBudget(
        "[Object: unable to enumerate]",
        state,
        MAX_STRING_VALUE_BYTES,
      );
    }
    if (hasMoreKeys && state.remainingBytes > 0) {
      result.__dyad_truncated__ = takeStringWithinBudget(
        "Additional keys omitted",
        state,
        MAX_STRING_VALUE_BYTES,
      );
    }
    return result;
  }

  function stringifyArg(arg) {
    if (arg === null) return "null";
    if (arg === undefined) return "undefined";
    if (typeof arg === "string") {
      return truncateUtf8(arg, MAX_ARGUMENT_BYTES);
    }
    if (typeof arg !== "object") {
      if (typeof arg === "function") {
        return `[Function ${truncateUtf8(arg.name || "anonymous", MAX_OBJECT_KEY_BYTES)}]`;
      }
      return truncateUtf8(String(arg), MAX_ARGUMENT_BYTES);
    }

    try {
      const sanitized = sanitizeValue(
        arg,
        {
          seen: new WeakSet(),
          remainingNodes: MAX_SERIALIZED_NODES,
          remainingBytes: MAX_ARGUMENT_BYTES,
        },
        0,
      );
      return truncateUtf8(
        JSON.stringify(sanitized, null, 2),
        MAX_ARGUMENT_BYTES,
      );
    } catch {
      return "[Object: unable to stringify]";
    }
  }

  // Bound argument count, object traversal, depth, and string size before the
  // structured-clone boundary so a single console call cannot balloon either
  // the preview iframe or the parent renderer.
  function stringifyArgs(args) {
    const includedArgs = args.slice(0, MAX_ARGUMENTS).map(stringifyArg);
    if (args.length > MAX_ARGUMENTS) {
      includedArgs.push(`… [${args.length - MAX_ARGUMENTS} arguments omitted]`);
    }
    return includedArgs;
  }

  // Intercept console.log
  console.log = function (...args) {
    window.parent.postMessage(
      {
        type: "console-log",
        level: "log",
        args: stringifyArgs(args),
        timestamp: new Date().toISOString(),
      },
      "*",
    );
    originalLog.apply(console, args);
  };

  // Intercept console.warn
  console.warn = function (...args) {
    window.parent.postMessage(
      {
        type: "console-log",
        level: "warn",
        args: stringifyArgs(args),
        timestamp: new Date().toISOString(),
      },
      "*",
    );
    originalWarn.apply(console, args);
  };

  // Intercept console.error
  console.error = function (...args) {
    window.parent.postMessage(
      {
        type: "console-log",
        level: "error",
        args: stringifyArgs(args),
        timestamp: new Date().toISOString(),
      },
      "*",
    );
    originalError.apply(console, args);
  };

  // Intercept console.info
  console.info = function (...args) {
    window.parent.postMessage(
      {
        type: "console-log",
        level: "info",
        args: stringifyArgs(args),
        timestamp: new Date().toISOString(),
      },
      "*",
    );
    originalInfo.apply(console, args);
  };

  // Intercept console.debug
  console.debug = function (...args) {
    window.parent.postMessage(
      {
        type: "console-log",
        level: "debug",
        args: stringifyArgs(args),
        timestamp: new Date().toISOString(),
      },
      "*",
    );
    originalDebug.apply(console, args);
  };
})();
