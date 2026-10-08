import { stripVTControlCharacters } from "node:util";

/** Redact runner-only credentials before output or results leave the runner. */
export function createTestOutputRedactor(values: string[]) {
  const secrets = [...new Set(values.filter(Boolean))].sort(
    (a, b) => b.length - a.length,
  );
  const redact = (text: string) => {
    if (secrets.length) text = stripVTControlCharacters(text);
    for (const secret of secrets) text = text.split(secret).join("[redacted]");
    return text;
  };

  return {
    redact,
    result<T>(value: T): T {
      return JSON.parse(JSON.stringify(value), (_key, item) =>
        typeof item === "string" ? redact(item) : item,
      );
    },
    stream(emit: (chunk: string) => void) {
      let pending = "";
      let pendingControl = "";
      return {
        push(chunk: string) {
          if (secrets.length) {
            chunk = pendingControl + chunk;
            pendingControl = "";
            // Playwright inserts ANSI highlighting inside assertion values.
            // Keep incomplete CSI sequences until the next pipe chunk.
            const escapeIndex = chunk.lastIndexOf("\x1b");
            if (
              escapeIndex >= 0 &&
              /^\x1b(?:\[[0-?]*[ -/]*)?$/.test(chunk.slice(escapeIndex))
            ) {
              pendingControl = chunk.slice(escapeIndex);
              chunk = chunk.slice(0, escapeIndex);
            }
            chunk = stripVTControlCharacters(chunk);
          }
          pending += chunk;
          let output = "";
          while (pending) {
            const match = secrets.find((secret) => pending.startsWith(secret));
            if (match) {
              output += "[redacted]";
              pending = pending.slice(match.length);
            } else if (secrets.some((secret) => secret.startsWith(pending))) {
              break;
            } else {
              output += pending[0];
              pending = pending.slice(1);
            }
          }
          if (output) emit(output);
        },
        flush() {
          // A trailing partial credential must not escape on early termination.
          if (pending) emit("[redacted]");
          pending = "";
          pendingControl = "";
        },
      };
    },
  };
}
