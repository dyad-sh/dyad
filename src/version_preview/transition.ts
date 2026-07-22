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
  BranchSwitchFallback,
  PreviewCommand,
  PreviewEvent,
  PreviewSession,
  PreviewState,
} from "./state";
import { CLOSED_STATE } from "./state";
import {
  ignore as ignoreTransition,
  type IgnoreReason,
  type TransitionResult as SharedTransitionResult,
} from "@/state_machines/types";

export type PreviewIgnoreReason = IgnoreReason<
  "invalid-in-current-state" | "no-change"
>;
export type TransitionResult = SharedTransitionResult<
  PreviewState,
  PreviewCommand,
  PreviewIgnoreReason
>;

export const BRANCH_UNAVAILABLE_MESSAGE =
  "Unable to determine the current Git branch. Version preview was cancelled to avoid switching branches.";

/** Explicitly ignore an event: same state reference, no commands. */
function ignore(
  state: PreviewState,
  reason: PreviewIgnoreReason,
): TransitionResult {
  return ignoreTransition<PreviewState, PreviewCommand, PreviewIgnoreReason>(
    state,
    reason,
  );
}

function freshSession(appId: number): PreviewSession {
  return {
    appId,
    originBranch: null,
    targetVersionId: null,
    checkedOutVersionId: null,
    exitIntent: { type: "none" },
    selectedDiffFile: null,
    isDiffVisible: false,
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
    isDiffVisible: false,
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

function beginBranchSwitch(
  fallback: BranchSwitchFallback,
  event: Extract<PreviewEvent, { type: "SWITCH_BRANCH" }>,
  commands: PreviewCommand[] = [],
): TransitionResult {
  return {
    state: {
      type: "switching-branch",
      appId: event.appId,
      branch: event.branch,
      fallback,
    },
    commands: [
      ...commands,
      { type: "switch-branch", appId: event.appId, branch: event.branch },
    ],
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
  if (event.type === "CLOSE_VERSION_DIFF") {
    if (state.type === "closed" || state.type === "switching-branch") {
      return ignore(state, "invalid-in-current-state");
    }
    if (!state.session.isDiffVisible) return ignore(state, "no-change");
    if (state.type === "viewing-diff") {
      return { state: CLOSED_STATE, commands: [] };
    }
    return {
      state: {
        ...state,
        session: {
          ...state.session,
          selectedDiffFile: null,
          isDiffVisible: false,
        },
      },
      commands: [],
    };
  }

  if (event.type === "SELECT_DIFF_FILE") {
    if (
      state.type === "closed" ||
      state.type === "switching-branch" ||
      !state.session.isDiffVisible
    ) {
      return ignore(state, "invalid-in-current-state");
    }
    const selected = state.session.selectedDiffFile;
    if (
      selected === event.file ||
      (selected !== null &&
        event.file !== null &&
        selected.versionId === event.file.versionId &&
        selected.path === event.file.path)
    ) {
      return ignore(state, "no-change");
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
      if (event.type === "SWITCH_BRANCH") {
        return beginBranchSwitch({ type: "closed" }, event);
      }
      if (event.type === "VIEW_VERSION_DIFF") {
        return {
          state: {
            type: "viewing-diff",
            session: {
              ...freshSession(event.appId),
              targetVersionId: event.versionId,
              selectedDiffFile: event.file,
              isDiffVisible: true,
            },
          },
          commands: [],
        };
      }
      return ignore(state, "invalid-in-current-state");
    }

    case "viewing-diff": {
      if (event.type === "VIEW_VERSION_DIFF") {
        return {
          state: {
            type: "viewing-diff",
            session: {
              ...state.session,
              targetVersionId: event.versionId,
              selectedDiffFile: event.file,
              isDiffVisible: true,
            },
          },
          commands: [],
        };
      }
      if (event.type === "OPEN") {
        return {
          state: {
            type: "browsing",
            session: {
              ...state.session,
              targetVersionId: null,
              selectedDiffFile: null,
              isDiffVisible: false,
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
          isDiffVisible: true,
        };
        return {
          state: { type: "resolving-origin", session },
          commands: [{ type: "resolve-origin", appId: session.appId }],
        };
      }
      if (event.type === "RESTORE" || event.type === "RESTORE_TO_MESSAGE") {
        return beginRestore(state.session, event, "closed");
      }
      if (event.type === "SWITCH_BRANCH") {
        return beginBranchSwitch(state, event);
      }
      if (exitIntentFor(event)) return { state: CLOSED_STATE, commands: [] };
      return ignore(state, "invalid-in-current-state");
    }

    case "browsing": {
      if (event.type === "VIEW_VERSION_DIFF") {
        return {
          state: {
            type: "viewing-diff",
            session: {
              ...state.session,
              targetVersionId: event.versionId,
              selectedDiffFile: event.file,
              isDiffVisible: true,
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
          isDiffVisible: true,
        };
        return {
          state: { type: "resolving-origin", session },
          commands: [{ type: "resolve-origin", appId: session.appId }],
        };
      }
      if (event.type === "RESTORE" || event.type === "RESTORE_TO_MESSAGE") {
        return beginRestore(state.session, event, "browsing");
      }
      if (event.type === "SWITCH_BRANCH") {
        return beginBranchSwitch(state, event);
      }
      if (exitIntentFor(event)) {
        return { state: CLOSED_STATE, commands: [] };
      }
      return ignore(state, "invalid-in-current-state");
    }

    case "resolving-origin": {
      if (event.type === "SELECT_VERSION") {
        if (
          state.session.targetVersionId === event.versionId &&
          state.session.selectedDiffFile === null
        ) {
          return ignore(state, "invalid-in-current-state");
        }
        // Latest selection wins; the superseded resolve is dropped by the
        // controller's epoch check.
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: event.versionId,
          selectedDiffFile: null,
          isDiffVisible: true,
        };
        return {
          state: { type: "resolving-origin", session },
          commands: [{ type: "resolve-origin", appId: session.appId }],
        };
      }
      if (event.type === "ORIGIN_RESOLVED") {
        if (state.session.targetVersionId === null) {
          return ignore(state, "invalid-in-current-state");
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
          isDiffVisible: false,
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
      return ignore(state, "invalid-in-current-state");
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
          return ignore(state, "invalid-in-current-state");
        }
        return {
          state: {
            type: "checking-out",
            session: { ...state.session, exitIntent: intent },
          },
          commands: [],
        };
      }
      return ignore(state, "invalid-in-current-state");
    }

    case "previewing": {
      if (event.type === "SELECT_VERSION") {
        if (state.session.targetVersionId === event.versionId) {
          if (
            state.session.selectedDiffFile === null &&
            state.session.isDiffVisible
          ) {
            return ignore(state, "no-change");
          }
          return {
            state: {
              type: "previewing",
              session: {
                ...state.session,
                selectedDiffFile: null,
                isDiffVisible: true,
              },
            },
            commands: [],
          };
        }
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: event.versionId,
          selectedDiffFile: null,
          isDiffVisible: true,
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
      if (event.type === "SWITCH_BRANCH") {
        return beginBranchSwitch(state, event);
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
      return ignore(state, "invalid-in-current-state");
    }

    case "restoring": {
      if (event.type === "RESTORE_SUCCEEDED") {
        if (event.repositoryOutcome === "target-applied") {
          // The restore landed on the requested branch/version; the session no
          // longer owns a historical checkout, so closing is safe.
          return { state: CLOSED_STATE, commands: [] };
        }
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: state.session.checkedOutVersionId,
          selectedDiffFile: null,
          isDiffVisible: false,
        };
        return settleWithExitIntent(session, (s) => {
          if (state.fallback === "closed") return CLOSED_STATE;
          if (state.fallback === "browsing") {
            return { type: "browsing", session: s };
          }
          return { type: "previewing", session: s };
        });
      }
      if (event.type === "RESTORE_FAILED") {
        const session: PreviewSession = {
          ...state.session,
          targetVersionId: state.session.checkedOutVersionId,
          selectedDiffFile: null,
          isDiffVisible: false,
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
          return ignore(state, "invalid-in-current-state");
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
      return ignore(state, "invalid-in-current-state");
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
          return ignore(state, "invalid-in-current-state");
        }
        return {
          state: {
            type: "returning",
            session: { ...state.session, exitIntent: intent },
          },
          commands: [],
        };
      }
      return ignore(state, "invalid-in-current-state");
    }

    case "switching-branch": {
      if (event.type === "SWITCH_BRANCH_SUCCEEDED") {
        return { state: CLOSED_STATE, commands: [] };
      }
      if (event.type === "SWITCH_BRANCH_FAILED") {
        if (state.fallback.type === "recovery-required") {
          return {
            state: state.fallback,
            commands: [
              {
                type: "notify-recovery",
                appId: state.fallback.session.appId,
                error: state.fallback.error,
              },
            ],
          };
        }
        return {
          state: state.fallback,
          commands: [],
        };
      }
      return ignore(state, "invalid-in-current-state");
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
      if (event.type === "SWITCH_BRANCH") {
        return beginBranchSwitch(state, event, [
          { type: "dismiss-recovery", appId: state.session.appId },
        ]);
      }
      // SELECT_VERSION and completion events are deliberately ignored.
      return ignore(state, "invalid-in-current-state");
    }
  }
}
