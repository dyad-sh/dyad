import * as fs from "node:fs";
import * as path from "node:path";

const BENCHMARK_ROOT = "benchmark-results/code-explorer";

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
