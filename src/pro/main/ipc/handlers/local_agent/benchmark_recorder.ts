import * as fs from "node:fs";
import * as path from "node:path";

const BENCHMARK_ROOT = "benchmark-results/code-explorer";
const DEFAULT_PREVIEW_LIMIT = 6_000;

export function recordCodeExplorerBenchmarkEvent(
  event: Record<string, unknown>,
): void {
  const runId = process.env.DYAD_BENCHMARK_RUN_ID;
  if (!runId) {
    return;
  }

  try {
    const outDir = path.join(
      process.cwd(),
      BENCHMARK_ROOT,
      sanitizeRunId(runId),
    );
    fs.mkdirSync(outDir, { recursive: true });
    fs.appendFileSync(
      path.join(outDir, "events.jsonl"),
      JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
    );
  } catch {
    // Benchmark recording must never affect normal agent execution.
  }
}

function sanitizeRunId(runId: string): string {
  return runId.replace(/[^A-Za-z0-9_.-]/g, "_");
}

export function summarizeBenchmarkValue(
  value: unknown,
  maxLength = DEFAULT_PREVIEW_LIMIT,
): string {
  const seen = new WeakSet<object>();
  let text: string;
  if (typeof value === "string") {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, (_key, nestedValue) => {
        if (typeof nestedValue === "bigint") {
          return nestedValue.toString();
        }
        if (typeof nestedValue === "object" && nestedValue !== null) {
          if (seen.has(nestedValue)) {
            return "[Circular]";
          }
          seen.add(nestedValue);
        }
        return nestedValue;
      });
    } catch {
      text = String(value);
    }
  }

  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}... [truncated ${text.length - maxLength} chars]`;
}
