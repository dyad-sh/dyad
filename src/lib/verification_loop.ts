/**
 * Multi-attempt verification loop for JoyCreate.
 *
 * Runs TypeScript diagnostics, parses errors, generates a fix prompt,
 * calls the agent, and re-verifies — up to `maxAttempts` times with
 * escalating strategies (direct fix → broader context → rollback).
 */

import log from "electron-log";
import { generateProblemReport } from "@/ipc/processors/tsc";
import {
  problemReportToStructuredErrors,
  formatErrorsForAgent,
  suggestFixStrategy,
} from "@/lib/error_parser";
import type {
  StructuredError,
  FixApproach,
  VerificationAttempt,
  VerificationResult,
} from "@/types/error_types";

const logger = log.scope("verification-loop");

const BACKOFF_MS = [0, 2_000, 5_000];

const APPROACHES: FixApproach[] = [
  "direct",
  "broader_context",
  "rollback_and_retry",
];

export interface VerificationCallbacks {
  /**
   * Called to send a fix prompt to the agent and wait for it to finish.
   * The implementation should stream the response, call tools, etc.
   * Returns the text the agent produced (for logging/diagnostics).
   */
  runFixAttempt: (prompt: string, approach: FixApproach) => Promise<string>;

  /** Called when a verification attempt starts. */
  onAttemptStart?: (attempt: number, errorsFound: number) => void;

  /** Called when a verification attempt finishes. */
  onAttemptEnd?: (attempt: VerificationAttempt) => void;

  /** Return true if the loop should abort (e.g. user cancelled). */
  isAborted?: () => boolean;
}

/**
 * Run the multi-attempt verification loop.
 *
 * 1. Check for TypeScript errors via `generateProblemReport`.
 * 2. If errors found, generate a fix prompt with the appropriate strategy.
 * 3. Call `callbacks.runFixAttempt()` to let the agent attempt a fix.
 * 4. Re-check. Repeat up to `maxAttempts`.
 *
 * Returns a VerificationResult summarising what happened.
 */
export async function runVerificationLoop(
  appPath: string,
  maxAttempts: number,
  callbacks: VerificationCallbacks,
): Promise<VerificationResult> {
  const loopStart = Date.now();
  const attempts: VerificationAttempt[] = [];
  let remainingErrors: StructuredError[] = [];

  for (let i = 0; i < maxAttempts; i++) {
    if (callbacks.isAborted?.()) {
      logger.info("Verification loop aborted by caller.");
      break;
    }

    const approach = APPROACHES[Math.min(i, APPROACHES.length - 1)];
    const attemptStart = Date.now();

    // 1. Run TypeScript diagnostics
    let errors: StructuredError[];
    try {
      const report = await generateProblemReport({
        fullResponse: "",
        appPath,
      });
      errors = problemReportToStructuredErrors(report);
    } catch (err) {
      logger.warn(`Verification check failed on attempt ${i + 1}:`, err);
      break;
    }

    // No errors → we're done
    if (errors.length === 0) {
      logger.info(
        `Verification passed on attempt ${i + 1} (${Date.now() - loopStart}ms total)`,
      );
      return {
        passed: true,
        attempts,
        totalAttempts: i + 1,
        remainingErrors: [],
        totalDurationMs: Date.now() - loopStart,
      };
    }

    callbacks.onAttemptStart?.(i + 1, errors.length);
    logger.info(
      `Verification attempt ${i + 1}/${maxAttempts}: ${errors.length} errors found, approach=${approach}`,
    );

    // 2. Generate fix prompt
    const prompt = buildFixPrompt(errors, approach, i + 1, maxAttempts);

    // 3. Backoff before calling agent (skip on first attempt)
    const delay = BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)];
    if (delay > 0) {
      await sleep(delay);
    }

    // 4. Run fix attempt
    const errorsBeforeFix = errors.length;
    try {
      await callbacks.runFixAttempt(prompt, approach);
    } catch (err) {
      logger.warn(`Fix attempt ${i + 1} threw:`, err);
    }

    // 5. Record attempt
    const attempt: VerificationAttempt = {
      attemptNumber: i + 1,
      approach,
      errorsBeforeFix,
      errorsAfterFix: -1, // filled in on next iteration or below
      durationMs: Date.now() - attemptStart,
    };

    // 6. Re-check to fill in errorsAfterFix
    try {
      const recheck = await generateProblemReport({
        fullResponse: "",
        appPath,
      });
      const recheckErrors = problemReportToStructuredErrors(recheck);
      attempt.errorsAfterFix = recheckErrors.length;
      remainingErrors = recheckErrors;

      if (recheckErrors.length === 0) {
        attempts.push(attempt);
        callbacks.onAttemptEnd?.(attempt);
        logger.info(
          `Verification passed after fix attempt ${i + 1} (${Date.now() - loopStart}ms total)`,
        );
        return {
          passed: true,
          attempts,
          totalAttempts: i + 1,
          remainingErrors: [],
          totalDurationMs: Date.now() - loopStart,
        };
      }
    } catch {
      attempt.errorsAfterFix = errorsBeforeFix;
    }

    attempts.push(attempt);
    callbacks.onAttemptEnd?.(attempt);
  }

  logger.info(
    `Verification failed after ${attempts.length} attempts, ${remainingErrors.length} errors remain`,
  );
  return {
    passed: false,
    attempts,
    totalAttempts: attempts.length,
    remainingErrors,
    totalDurationMs: Date.now() - loopStart,
  };
}

// ---------------------------------------------------------------------------
// Prompt builders — escalating strategies
// ---------------------------------------------------------------------------

function buildFixPrompt(
  errors: StructuredError[],
  approach: FixApproach,
  attempt: number,
  maxAttempts: number,
): string {
  const base = formatErrorsForAgent(errors);

  switch (approach) {
    case "direct":
      return (
        `[Verification attempt ${attempt}/${maxAttempts}]\n\n` +
        base +
        "\n\nFix each error directly. Be precise and minimal."
      );

    case "broader_context":
      return (
        `[Verification attempt ${attempt}/${maxAttempts} — previous fix didn't resolve all errors]\n\n` +
        base +
        "\n\nThe direct approach didn't fully work. Read the surrounding code for context " +
        "before fixing. Check if the issue is caused by an incorrect assumption in a different file."
      );

    case "rollback_and_retry":
      return (
        `[Verification attempt ${attempt}/${maxAttempts} — FINAL attempt]\n\n` +
        base +
        "\n\nPrevious fix attempts failed. Consider reverting problematic changes and taking " +
        "a completely different approach. If a type error persists, simplify the types. " +
        "If an import error persists, check that the module actually exports what you need."
      );

    default:
      return base;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
