import type { TestResult } from "@/ipc/types/tests";

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;

/**
 * Strip run-to-run dynamic bits from error text so the same underlying failure
 * produces the same signature across attempts. Removes ANSI codes, durations,
 * ports, hex ids, and timestamps, then collapses whitespace.
 */
export function stripDynamic(text: string): string {
  return (
    text
      .replace(ANSI_RE, "")
      // Timestamps first: they contain colons, so port-stripping would mangle
      // them and leave the seconds behind.
      .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, "<ts>")
      .replace(/\b\d+(?:\.\d+)?\s?ms\b/gi, "<dur>")
      .replace(/\b\d+(?:\.\d+)?\s?s\b/gi, "<dur>")
      .replace(/:\d{2,5}\b/g, ":<port>")
      .replace(/\b[0-9a-f]{8,}\b/gi, "<hex>")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** First non-blank line of an error, with dynamic bits stripped. */
function firstErrorLine(error: string | undefined): string {
  if (!error) return "";
  const line = error.split("\n").find((l) => l.trim()) ?? "";
  return stripDynamic(line);
}

/** A test that ran and didn't pass: assertion ("failed") or "inconclusive". */
function isFailing(status: string): boolean {
  return status === "failed" || status === "inconclusive";
}

/**
 * Build a stable signature of a run's failures: one sorted entry per failing
 * test (or file) as `file :: title :: first-error-line`, dynamic bits stripped.
 * Two runs with the same signature failed the same way — used to tell the agent
 * its last change didn't move the needle. Covers both assertion failures and
 * "inconclusive" (selector/timeout) failures, since the agent fixes both.
 */
export function normalizeFailureSignature(results: TestResult[]): string {
  const entries: string[] = [];
  for (const r of results) {
    if (r.tests && r.tests.length > 0) {
      for (const t of r.tests) {
        if (isFailing(t.status)) {
          entries.push(`${r.file} :: ${t.title} :: ${firstErrorLine(t.error)}`);
        }
      }
    } else if (isFailing(r.status)) {
      entries.push(`${r.file} :: <file> :: ${firstErrorLine(r.error)}`);
    }
  }
  return entries.sort().join("\n");
}
