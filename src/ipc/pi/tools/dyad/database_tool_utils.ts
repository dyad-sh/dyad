const MAX_DATABASE_TOOL_RESULT_BYTES = 64 * 1024;
const DATABASE_RESULT_TRUNCATION_NOTICE =
  "\n\n[Database result truncated. Narrow the query or request one table at a time.]";

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("Aborted", "AbortError");
}

export function runAbortable<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) {
    return operation();
  }
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    operation().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function boundDatabaseToolResult(result: string): string {
  if (Buffer.byteLength(result, "utf8") <= MAX_DATABASE_TOOL_RESULT_BYTES) {
    return result;
  }

  const contentBytes =
    MAX_DATABASE_TOOL_RESULT_BYTES -
    Buffer.byteLength(DATABASE_RESULT_TRUNCATION_NOTICE, "utf8");
  const prefix = Buffer.from(result, "utf8")
    .subarray(0, contentBytes)
    .toString("utf8")
    .replace(/\uFFFD$/, "");
  return prefix + DATABASE_RESULT_TRUNCATION_NOTICE;
}
