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
import { CLOSED_STATE, isPaneVisibleState } from "./state";

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
    checkedOutVersionId: null,
    exitIntent: { type: "none" },
    selectedDiffFile: null,
  };
}

type RestoreIntent = Extract<
  PreviewEvent,
  { type: "RESTORE" | "RESTORE_TO_MESSAGE" }
>;

function beginRestore(
  session: PreviewSession,
  event: RestoreIntent,
  fallback: Extract<PreviewState, { type: "restoring" }>["fallback"],
): TransitionResult {
  const nextSession: PreviewSession = {
    ...session,
    targetVersionId:
      event.type === "RESTORE" ? event.versionId : session.targetVersionId,
    selectedDiffFile: null,
  };
  const targetBranch =
    nextSession.checkedOutVersionId === null ? null : nextSession.originBranch;
  const command: PreviewCommand =
    event.type === "RESTORE"
      ? {
          type: "restore",
          appId: nextSession.appId,
          versionId: event.versionId,
          targetBranch,
          currentChatMessageId: event.currentChatMessageId,
        }
      : {
          type: "restore-to-message",
          appId: nextSession.appId,
          chatId: event.chatId,
          messageId: event.messageId,
          restoreCodebase: event.restoreCodebase,
          targetBranch,
        };
  return {
    state: { type: "restoring", session: nextSession, fallback },
    commands: [command],
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

function sameExitIntent(a: ExitIntent, b: ExitIntent): boolean {
  if (a.type !== b.type) return false;
  return (
    a.type !== "switch-app" ||
    (b.type === "switch-app" && a.nextAppId === b.nextAppId)
  );
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
  if (event.type === "SELECT_DIFF_FILE") {
    if (!isPaneVisibleState(state) || state.type === "closed") {
      return ignore(state);
    }
    const selected = state.session.selectedDiffFile;
    if (
      selected === event.file ||
      (selected !== null &&
        event.file !== null &&
        selected.versionId === event.file.versionId &&
        selected.path === event.file.path)
    ) {
      return ignore(state);
    }
    return {
      state: {
        ...state,
        session: { ...state.session, selectedDiffFile: event.file },
      },
      commands: [],
    };
  }

  switch (state.type) {
    case "closed": {
      if (event.type === "OPEN") {
        return {
          state: { type: "browsing", session: freshSession(event.appId) },
          commands: [],
        };
      }
      if (event.type === "RESTORE" || event.type === "RESTORE_TO_MESSAGE") {
        return beginRestore(freshSession(event.appId), event, "closed");
      }
      if (event.type === "VIEW_VERSION_DIFF") {
        return {
          state: {
            type: "browsing",
            session: {
              ...freshSession(event.appId),
              targetVersionId: event.versionId,
              selectedDiffFile: event.file,
            },
          },
          commands: [],
        };
      }
      return ignore(state);
    }

    case "browsing": {
      if (event.type === "VIEW_VERSION_DIFF") {
        return {
          state: {
            type: "browsing",
            session: {
              ...state.session,
              targetVersionId: event.versionId,
              selectedDiffFile: event.file,
            },
          },
          commands: [],
        };
      }
      if (event.type === "SELECT_VERSION") {
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: event.versionId,
          selectedDiffFile: null,
        };
        return {
          state: { type: "resolving-origin", session },
          commands: [{ type: "resolve-origin", appId: session.appId }],
        };
      }
      if (event.type === "RESTORE" || event.type === "RESTORE_TO_MESSAGE") {
        return beginRestore(state.session, event, "browsing");
      }
      if (exitIntentFor(event)) {
        return { state: CLOSED_STATE, commands: [] };
      }
      return ignore(state);
    }

    case "resolving-origin": {
      if (event.type === "SELECT_VERSION") {
        if (
          state.session.targetVersionId === event.versionId &&
          state.session.selectedDiffFile === null
        ) {
          return ignore(state);
        }
        // Latest selection wins; the superseded resolve is dropped by the
        // controller's epoch check.
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: event.versionId,
          selectedDiffFile: null,
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
            },
          ],
        };
      }
      if (event.type === "ORIGIN_RESOLUTION_FAILED") {
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: state.session.checkedOutVersionId,
          selectedDiffFile: null,
        };
        // Reachable resolving-origin states never own a checkout, but stay
        // defensive: fall back to previewing rather than losing one.
        const hasCheckout =
          session.checkedOutVersionId !== null && session.originBranch !== null;
        return {
          state: hasCheckout
            ? { type: "previewing", session }
            : {
                type: "browsing",
                // A session that never checked out releases its captured
                // branch so the next selection re-captures the live one.
                session: { ...session, originBranch: null },
              },
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
          selectedDiffFile: null,
        };
        return settleWithExitIntent(session, (s) =>
          s.checkedOutVersionId === null
            ? // The session never owned a checkout: release the captured
              // branch so a later selection re-captures the live branch
              // (preserves b249bb40's capture-immediately-before-checkout
              // guarantee even if the branch changed externally meanwhile).
              {
                type: "browsing",
                session: { ...s, originBranch: null },
              }
            : { type: "previewing", session: s },
        );
      }
      const intent = exitIntentFor(event);
      if (intent) {
        if (sameExitIntent(state.session.exitIntent, intent)) {
          return ignore(state);
        }
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
        if (state.session.targetVersionId === event.versionId) {
          if (state.session.selectedDiffFile === null) return ignore(state);
          return {
            state: {
              type: "previewing",
              session: { ...state.session, selectedDiffFile: null },
            },
            commands: [],
          };
        }
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: event.versionId,
          selectedDiffFile: null,
        };
        return {
          state: { type: "checking-out", session },
          commands: [
            {
              type: "checkout",
              appId: session.appId,
              versionId: event.versionId,
            },
          ],
        };
      }
      if (event.type === "RESTORE" || event.type === "RESTORE_TO_MESSAGE") {
        return beginRestore(state.session, event, "previewing");
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
          selectedDiffFile: null,
        };
        return settleWithExitIntent(session, (s) => {
          if (state.fallback === "closed") return CLOSED_STATE;
          if (state.fallback === "browsing") {
            return { type: "browsing", session: s };
          }
          return { type: "previewing", session: s };
        });
      }
      const intent = exitIntentFor(event);
      if (intent) {
        if (sameExitIntent(state.session.exitIntent, intent)) {
          return ignore(state);
        }
        return {
          state: {
            type: "restoring",
            session: { ...state.session, exitIntent: intent },
            fallback: state.fallback,
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
          commands: [
            {
              type: "notify-recovery",
              appId: state.session.appId,
              error: event.error,
            },
          ],
        };
      }
      const intent = exitIntentFor(event);
      if (intent) {
        // Already exiting; just record the most recent intent.
        if (sameExitIntent(state.session.exitIntent, intent)) {
          return ignore(state);
        }
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
          commands: [
            { type: "dismiss-recovery", appId: state.session.appId },
            returnCommand(state.session),
          ],
        };
      }
      if (event.type === "OPEN") {
        return {
          state,
          commands: [
            {
              type: "notify-recovery",
              appId: state.session.appId,
              error: state.error,
            },
          ],
        };
      }
      // SELECT_VERSION and completion events are deliberately ignored.
      return ignore(state);
    }
  }
}
