/**
 * Pure transition function for the version preview state machine.
 *
 * Rules (enforced by tests in transition.test.ts):
 * - Total: every (state, event) pair returns a result. Deliberately ignored
 *   pairs go through ignore() so they are distinguishable from omissions.
 * - Pure: no I/O, no Date, no randomness, no imports beyond domain types.
 * - Commands are data; execution belongs to the controller.
 * - At most one Git-mutating command per result.
 */

import type {
  ExitIntent,
  PreviewCommand,
  PreviewEvent,
  PreviewSession,
  PreviewState,
} from "./state";
import { CLOSED_STATE } from "./state";

export interface TransitionResult {
  state: PreviewState;
  commands: PreviewCommand[];
}

export const BRANCH_UNAVAILABLE_MESSAGE =
  "Unable to determine the current Git branch. Version preview was cancelled to avoid switching branches.";

/** Explicitly ignore an event: same state reference, no commands. */
function ignore(state: PreviewState): TransitionResult {
  return { state, commands: [] };
}

function freshSession(appId: number): PreviewSession {
  return {
    appId,
    originBranch: null,
    targetVersionId: null,
    targetHasDbSnapshot: false,
    checkedOutVersionId: null,
    exitIntent: { type: "none" },
  };
}

/** Maps CLOSE / APP_CHANGED to an exit intent; null for other events. */
function exitIntentFor(event: PreviewEvent): ExitIntent | null {
  if (event.type === "CLOSE") {
    return { type: "close" };
  }
  if (event.type === "APP_CHANGED") {
    return { type: "switch-app", nextAppId: event.nextAppId };
  }
  return null;
}

function returnCommand(session: PreviewSession): PreviewCommand {
  // returning is only reachable after originBranch was captured; the
  // invariant checker in tests asserts this for every reachable state.
  return {
    type: "return",
    appId: session.appId,
    branch: session.originBranch ?? "",
  };
}

/**
 * Leaves a mutating state after the mutation settled, honoring a recorded
 * exit intent: return to the origin branch if this session owns a historical
 * checkout, close outright if it does not, or stay open in fallbackState.
 */
function settleWithExitIntent(
  session: PreviewSession,
  fallbackState: (session: PreviewSession) => PreviewState,
): TransitionResult {
  if (session.exitIntent.type === "none") {
    return { state: fallbackState(session), commands: [] };
  }
  if (session.checkedOutVersionId === null) {
    return { state: CLOSED_STATE, commands: [] };
  }
  return {
    state: { type: "returning", session },
    commands: [returnCommand(session)],
  };
}

export function transition(
  state: PreviewState,
  event: PreviewEvent,
): TransitionResult {
  switch (state.type) {
    case "closed": {
      if (event.type === "OPEN") {
        return {
          state: { type: "browsing", session: freshSession(event.appId) },
          commands: [],
        };
      }
      return ignore(state);
    }

    case "browsing": {
      if (event.type === "SELECT_VERSION") {
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: event.versionId,
          targetHasDbSnapshot: event.hasDbSnapshot,
        };
        return {
          state: { type: "resolving-origin", session },
          commands: [{ type: "resolve-origin", appId: session.appId }],
        };
      }
      if (exitIntentFor(event)) {
        return { state: CLOSED_STATE, commands: [] };
      }
      return ignore(state);
    }

    case "resolving-origin": {
      if (event.type === "SELECT_VERSION") {
        // Latest selection wins; the superseded resolve is dropped by the
        // controller's epoch check.
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: event.versionId,
          targetHasDbSnapshot: event.hasDbSnapshot,
        };
        return {
          state: { type: "resolving-origin", session },
          commands: [{ type: "resolve-origin", appId: session.appId }],
        };
      }
      if (event.type === "ORIGIN_RESOLVED") {
        if (state.session.targetVersionId === null) {
          return ignore(state);
        }
        const session: PreviewSession = {
          ...state.session,
          originBranch: state.session.originBranch ?? event.branch,
        };
        return {
          state: { type: "checking-out", session },
          commands: [
            {
              type: "checkout",
              appId: session.appId,
              versionId: session.targetVersionId!,
              hasDbSnapshot: session.targetHasDbSnapshot,
            },
          ],
        };
      }
      if (event.type === "ORIGIN_RESOLUTION_FAILED") {
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: state.session.checkedOutVersionId,
          targetHasDbSnapshot: false,
        };
        // Reachable resolving-origin states never own a checkout, but stay
        // defensive: fall back to previewing rather than losing one.
        const hasCheckout =
          session.checkedOutVersionId !== null && session.originBranch !== null;
        return {
          state: hasCheckout
            ? { type: "previewing", session }
            : { type: "browsing", session },
          commands: [
            { type: "notify-error", message: BRANCH_UNAVAILABLE_MESSAGE },
          ],
        };
      }
      const intent = exitIntentFor(event);
      if (intent) {
        if (state.session.checkedOutVersionId === null) {
          // No historical checkout has started; closing needs no return.
          return { state: CLOSED_STATE, commands: [] };
        }
        const session: PreviewSession = {
          ...state.session,
          exitIntent: intent,
        };
        return {
          state: { type: "returning", session },
          commands: [returnCommand(session)],
        };
      }
      return ignore(state);
    }

    case "checking-out": {
      if (event.type === "CHECKOUT_SUCCEEDED") {
        const session: PreviewSession = {
          ...state.session,
          checkedOutVersionId: state.session.targetVersionId,
        };
        return settleWithExitIntent(session, (s) => ({
          type: "previewing",
          session: s,
        }));
      }
      if (event.type === "CHECKOUT_FAILED") {
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: state.session.checkedOutVersionId,
          targetHasDbSnapshot: false,
        };
        return settleWithExitIntent(session, (s) =>
          s.checkedOutVersionId === null
            ? { type: "browsing", session: s }
            : { type: "previewing", session: s },
        );
      }
      const intent = exitIntentFor(event);
      if (intent) {
        return {
          state: {
            type: "checking-out",
            session: { ...state.session, exitIntent: intent },
          },
          commands: [],
        };
      }
      return ignore(state);
    }

    case "previewing": {
      if (event.type === "SELECT_VERSION") {
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: event.versionId,
          targetHasDbSnapshot: event.hasDbSnapshot,
        };
        return {
          state: { type: "checking-out", session },
          commands: [
            {
              type: "checkout",
              appId: session.appId,
              versionId: event.versionId,
              hasDbSnapshot: event.hasDbSnapshot,
            },
          ],
        };
      }
      if (event.type === "RESTORE") {
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: event.versionId,
          targetHasDbSnapshot: event.hasDbSnapshot,
        };
        return {
          state: { type: "restoring", session },
          commands: [
            {
              type: "restore",
              appId: session.appId,
              versionId: event.versionId,
              targetBranch: session.originBranch ?? "",
              hasDbSnapshot: event.hasDbSnapshot,
            },
          ],
        };
      }
      const intent = exitIntentFor(event);
      if (intent) {
        const session: PreviewSession = {
          ...state.session,
          exitIntent: intent,
        };
        return {
          state: { type: "returning", session },
          commands: [returnCommand(session)],
        };
      }
      return ignore(state);
    }

    case "restoring": {
      if (event.type === "RESTORE_SUCCEEDED") {
        // The restore landed on the origin branch; the session no longer owns
        // a historical checkout, so closing is safe regardless of intent.
        return { state: CLOSED_STATE, commands: [] };
      }
      if (event.type === "RESTORE_FAILED") {
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: state.session.checkedOutVersionId,
          targetHasDbSnapshot: false,
        };
        return settleWithExitIntent(session, (s) => ({
          type: "previewing",
          session: s,
        }));
      }
      const intent = exitIntentFor(event);
      if (intent) {
        return {
          state: {
            type: "restoring",
            session: { ...state.session, exitIntent: intent },
          },
          commands: [],
        };
      }
      return ignore(state);
    }

    case "returning": {
      if (event.type === "RETURN_SUCCEEDED") {
        return { state: CLOSED_STATE, commands: [] };
      }
      if (event.type === "RETURN_FAILED") {
        return {
          state: {
            type: "recovery-required",
            session: state.session,
            error: event.error,
          },
          commands: [],
        };
      }
      const intent = exitIntentFor(event);
      if (intent) {
        // Already exiting; just record the most recent intent.
        return {
          state: {
            type: "returning",
            session: { ...state.session, exitIntent: intent },
          },
          commands: [],
        };
      }
      return ignore(state);
    }

    case "recovery-required": {
      if (event.type === "RETRY_RETURN") {
        return {
          state: { type: "returning", session: state.session },
          commands: [returnCommand(state.session)],
        };
      }
      // OPEN and SELECT_VERSION are deliberately ignored: recovery must
      // resolve before a new session can start for this app.
      return ignore(state);
    }
  }
}
