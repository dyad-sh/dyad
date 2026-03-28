import type { Problem, ProblemReport } from "../../shared/tsc_types";

// Re-export for convenience
export type { Problem, ProblemReport };

/**
 * Source of the raw error output — determines which parser strategy to use.
 */
export type ErrorSource =
  | "typescript"
  | "build"
  | "runtime"
  | "dependency"
  | "lint";

/**
 * High-level classification of what caused the error.
 */
export type ErrorCategory =
  | "syntax"
  | "type"
  | "missing_import"
  | "missing_module"
  | "dependency"
  | "runtime"
  | "config"
  | "lint"
  | "unknown";

/**
 * Recommended action the agent should take to resolve the error.
 */
export type FixStrategy =
  | "add_import"
  | "install_dep"
  | "fix_type"
  | "fix_syntax"
  | "refactor"
  | "config_change"
  | "add_declaration"
  | "remove_unused"
  | "manual_review";

/**
 * A parsed, categorized error with enough context for the agent to act on it.
 */
export interface StructuredError {
  source: ErrorSource;
  category: ErrorCategory;
  file?: string;
  line?: number;
  column?: number;
  code?: string | number;
  message: string;
  snippet?: string;
  /** The raw text that was parsed to produce this error. */
  rawText: string;
  suggestedFix?: FixStrategy;
  /** For dependency errors: the package name that's missing or conflicting. */
  packageName?: string;
}

/**
 * Strategy to use when attempting to fix errors. Escalates per attempt.
 */
export type FixApproach =
  | "direct"
  | "broader_context"
  | "rollback_and_retry";

/**
 * Outcome of a single verification attempt.
 */
export interface VerificationAttempt {
  attemptNumber: number;
  approach: FixApproach;
  errorsBeforeFix: number;
  errorsAfterFix: number;
  durationMs: number;
}

/**
 * Final result of the multi-attempt verification loop.
 */
export interface VerificationResult {
  passed: boolean;
  attempts: VerificationAttempt[];
  totalAttempts: number;
  remainingErrors: StructuredError[];
  totalDurationMs: number;
}

/**
 * Result from running a test suite.
 */
export interface TestResult {
  framework: "vitest" | "jest" | "mocha" | "unknown";
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  failures: TestFailure[];
  durationMs: number;
  rawOutput: string;
}

/**
 * A single test failure with enough detail for the agent to fix it.
 */
export interface TestFailure {
  testName: string;
  suiteName?: string;
  file?: string;
  message: string;
  expected?: string;
  actual?: string;
  stack?: string;
}
