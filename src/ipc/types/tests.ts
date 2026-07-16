import { z } from "zod";
import {
  createClient,
  createEventClient,
  defineContract,
  defineEvent,
} from "../contracts/core";

// =============================================================================
// E2E spec-file identity
// =============================================================================

/**
 * Single source of truth for which file extensions count as an E2E spec.
 * The glob (`TEST_SPEC_GLOB`), filename regex (`SPEC_FILE_RE`), the main
 * process' `TEST_FILE_PATTERN`, and the renderer all derive from this list,
 * so extending spec support (e.g. adding "mts") is a one-line change here.
 */
export const TEST_SPEC_EXTENSIONS = ["ts", "tsx", "js", "jsx"] as const;

/** Regex alternation fragment ("ts|tsx|js|jsx") for building spec-path regexes. */
export const TEST_SPEC_EXT_ALTERNATION = TEST_SPEC_EXTENSIONS.join("|");

/** Directory, relative to an app root, where Dyad-managed E2E specs live. */
export const TEST_SPEC_DIR = "e2e-tests";

/** Legacy Dyad-managed E2E spec directory, used only for one-time migration. */
export const LEGACY_TEST_SPEC_DIR = "tests";

/** Glob matching every E2E spec under an app's `e2e-tests/` folder. */
export const TEST_SPEC_GLOB = `${TEST_SPEC_DIR}/**/*.spec.{${TEST_SPEC_EXTENSIONS.join(",")}}`;

/** Matches a filename with a spec extension (any directory). */
export const SPEC_FILE_RE = new RegExp(
  `\\.spec\\.(${TEST_SPEC_EXT_ALTERNATION})$`,
);

// =============================================================================
// Tests Schemas
// =============================================================================

/**
 * A single `test()` case discovered inside a spec file by a best-effort static
 * parse. `line` is the 1-based line of the `test(` call and is what we hand to
 * Playwright (`file:line`) to run just this one test.
 */
export const TestCaseSchema = z.object({
  /** The test title as written in the file. */
  title: z.string(),
  /** 1-based line of the `test(` call. */
  line: z.number(),
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const TestSpecSchema = z.object({
  /** Path relative to the app root, e.g. "e2e-tests/signup.spec.ts". */
  file: z.string(),
  /**
   * Individual test cases found in the file (best-effort static parse). Empty
   * when the file couldn't be parsed; the file can still be run as a whole.
   */
  tests: z.array(TestCaseSchema).default([]),
});
export type TestSpec = z.infer<typeof TestSpecSchema>;

/**
 * On-disk run statuses. "running"/"not-run" are UI-only and never returned
 * by the handler.
 */
export const TestRunStatusSchema = z.enum(["passed", "failed", "inconclusive"]);
export type TestRunStatus = z.infer<typeof TestRunStatusSchema>;

/** Result for a single `test()` case within a file. */
export const TestCaseResultSchema = z.object({
  /** The test title from the Playwright report. */
  title: z.string(),
  /** 1-based line of the `test(` call, for matching back to a spec's tests. */
  line: z.number().optional(),
  status: TestRunStatusSchema,
  durationMs: z.number().optional(),
  /** Error text on failure (assertion or infra). */
  error: z.string().optional(),
  /** Best-effort absolute path to a failure screenshot. */
  screenshotPath: z.string().optional(),
});
export type TestCaseResult = z.infer<typeof TestCaseResultSchema>;

export const TestResultSchema = z.object({
  file: z.string(),
  status: TestRunStatusSchema,
  durationMs: z.number().optional(),
  /** Error text on failure (assertion or infra). */
  error: z.string().optional(),
  /** Best-effort absolute path to a failure screenshot. */
  screenshotPath: z.string().optional(),
  /** Per-test results within the file. */
  tests: z.array(TestCaseResultSchema).optional(),
});
export type TestResult = z.infer<typeof TestResultSchema>;

export const ListAppTestsParamsSchema = z.object({
  appId: z.number(),
});

export const ListAppTestsResultSchema = z.object({
  specs: z.array(TestSpecSchema),
});

export const RunAppTestsParamsSchema = z.object({
  appId: z.number(),
  /** When set, runs a single spec file (relative path); otherwise runs all. */
  testFile: z.string().optional(),
  /**
   * When set (with testFile), runs only the test whose `test(` call is at this
   * 1-based line, via Playwright's `file:line` selector.
   */
  testLine: z.number().int().positive().optional(),
  /**
   * When true, runs the browser in headed mode (a visible window) so the user
   * can watch the test drive the app. Defaults to headless.
   */
  headed: z.boolean().optional(),
  /**
   * When true, runs the targeted tests in parallel (overrides the generated
   * config's serial `workers: 1` / `fullyParallel: false`). Speeds up a file
   * with many independent tests, at the cost of them sharing one dev server.
   */
  parallel: z.boolean().optional(),
});

/**
 * Whether the run executed against an isolated, throwaway database:
 * - `neon-branch`: ran against an ephemeral Neon branch; real data untouched.
 * - `supabase-test-user`: ran against the app's real Supabase project, but
 *   authenticated as a throwaway test user scoped by Row-Level Security.
 *   `reason` (when set) is a warning — e.g. tables without RLS that the test
 *   could still affect.
 * - `none`: ran against the app's current database (no DB connected, or a
 *   provider without isolation support). `reason` explains why.
 */
export const TestIsolationSchema = z.object({
  mode: z.enum(["neon-branch", "supabase-test-user", "none"]),
  reason: z.string().optional(),
});
export type TestIsolation = z.infer<typeof TestIsolationSchema>;

export const RunAppTestsResultSchema = z.object({
  appId: z.number(),
  results: z.array(TestResultSchema),
  /**
   * Set when the entire run failed before producing per-test results (e.g.
   * Playwright/browser missing and bootstrap declined, dev server down, spawn
   * error, or an isolated test database could not be set up). Renders as an
   * amber, panel-level "inconclusive" banner.
   */
  infraError: z
    .object({
      message: z.string(),
    })
    .optional(),
  /**
   * How the run's database was isolated. Absent on legacy/no-DB paths; the UI
   * treats absent the same as `{ mode: "none" }`.
   */
  isolation: TestIsolationSchema.optional(),
});
export type RunAppTestsResult = z.infer<typeof RunAppTestsResultSchema>;

export const StopAppTestsParamsSchema = z.object({
  appId: z.number(),
});

export const GetTestScreenshotParamsSchema = z.object({
  appId: z.number(),
  /** Absolute path to the screenshot, as reported by Playwright. */
  path: z.string(),
});

export const GetTestScreenshotResultSchema = z.object({
  /** PNG data URL, or null if unavailable. */
  dataUrl: z.string().nullable(),
});

// =============================================================================
// Tests Contracts
// =============================================================================

export const testsContracts = {
  listAppTests: defineContract({
    channel: "tests:list",
    input: ListAppTestsParamsSchema,
    output: ListAppTestsResultSchema,
  }),

  runAppTests: defineContract({
    channel: "tests:run",
    input: RunAppTestsParamsSchema,
    output: RunAppTestsResultSchema,
  }),

  stopAppTests: defineContract({
    channel: "tests:stop",
    input: StopAppTestsParamsSchema,
    output: z.object({ ok: z.literal(true) }),
  }),

  getTestScreenshot: defineContract({
    channel: "tests:screenshot",
    input: GetTestScreenshotParamsSchema,
    output: GetTestScreenshotResultSchema,
  }),
} as const;

// =============================================================================
// Tests Events (main -> renderer streamed output)
// =============================================================================

export const TestOutputPayloadSchema = z.object({
  appId: z.number(),
  /** A chunk of raw bootstrap/runner output. */
  chunk: z.string(),
  /** Phase the run is in, so the panel can switch between setup/running copy. */
  phase: z.enum(["setup", "running"]),
});
export type TestOutputPayload = z.infer<typeof TestOutputPayloadSchema>;

/**
 * Lifecycle of a test run, so the panel can reflect runs it didn't start
 * itself (e.g. the agent's run_tests tool). The panel ignores `source:
 * "panel"` — its own `runAppTests` call already writes run state directly.
 */
export const TestsRunStatePayloadSchema = z.object({
  appId: z.number(),
  source: z.enum(["panel", "agent"]),
  state: z.enum(["started", "finished"]),
  /** Single spec targeted, when set; absent = whole suite. */
  testFile: z.string().optional(),
  /** With testFile: only the test at this 1-based line was run. */
  testLine: z.number().optional(),
  /** With testFile: regex passed to Playwright's --grep for a partial run. */
  grep: z.string().optional(),
  /** Present only on "finished". */
  results: z.array(TestResultSchema).optional(),
  infraError: z.object({ message: z.string() }).optional(),
  isolation: TestIsolationSchema.optional(),
});
export type TestsRunStatePayload = z.infer<typeof TestsRunStatePayloadSchema>;

export const testsEvents = {
  output: defineEvent({
    channel: "tests:output",
    payload: TestOutputPayloadSchema,
  }),
  runState: defineEvent({
    channel: "tests:run-state",
    payload: TestsRunStatePayloadSchema,
  }),
} as const;

// =============================================================================
// Tests Client
// =============================================================================

export const testsClient = createClient(testsContracts);
export const testsEventClient = createEventClient(testsEvents);
