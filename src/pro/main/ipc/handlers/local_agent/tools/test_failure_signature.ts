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
      .replace(
        /\b(https?:\/\/(?:\[[^\]]+\]|[^/\s:]+)):\d{2,5}\b/gi,
        "$1:<port>",
      )
      // Bare `host:port` (no scheme) churns the signature the same way. Match
      // only real host forms — a blanket `:\d+` rule would also eat the
      // line:column numbers in `foo.spec.ts:12:5` stack frames, which are
      // exactly the stable part a signature needs. A leading lookbehind rather
      // than `\b`, which would never match a bracketed IPv6 host: `\b` before
      // `[` needs a word char right before the bracket, but error output has a
      // space (or nothing) there.
      .replace(
        /(?<![\w.])(localhost|\d{1,3}(?:\.\d{1,3}){3}|\[[0-9a-f:.]+\]):\d{2,5}\b/gi,
        "$1:<port>",
      )
      // UUIDs before the contiguous-hex rule: their 4-char middle segments are
      // too short for it, so a generated id would otherwise change the
      // signature on every run and defeat no-progress detection.
      .replace(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
        "<uuid>",
      )
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

/**
 * A test that RAN and didn't pass — both "failed" (assertion) and
 * "inconclusive" (selector/timeout/strict-mode, which Playwright's error
 * heuristic flags as infra-ish) count. Only a whole-run failure that produced
 * NO report — surfaced separately as `infraError` — is a true environment
 * problem; anything with a per-test verdict is a fixable test result.
 *
 * Lives here (a leaf module) as the single source of truth so failure
 * signatures can never disagree with `run_tests_utils`' result classification.
 */
export function isFailingStatus(status: string): boolean {
  return status === "failed" || status === "inconclusive";
}

export function isSkippedVerdict(v: {
  status: string;
  error?: string;
}): boolean {
  return v.status === "inconclusive" && !v.error;
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
        if (isFailingStatus(t.status) && !isSkippedVerdict(t)) {
          entries.push(`${r.file} :: ${t.title} :: ${firstErrorLine(t.error)}`);
        }
      }
    } else if (isFailingStatus(r.status) && !isSkippedVerdict(r)) {
      entries.push(`${r.file} :: <file> :: ${firstErrorLine(r.error)}`);
    }
  }
  return entries.sort().join("\n");
}
