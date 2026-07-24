import { describe, expect, it } from "vitest";
import { assertCapabilityTransitionConsistency } from "@/state_machines/testing";
import type { PreviewEvent, PreviewSession, PreviewState } from "./state";
import { CLOSED_STATE } from "./state";
import {
  projectVersionPreview,
  selectVersionPreviewCapabilities,
} from "./projection";
import { transition } from "./transition";

const APP_ID = 7;

function session(): PreviewSession {
  return {
    appId: APP_ID,
    originBranch: "feature",
    targetVersionId: "v1",
    checkedOutVersionId: "v1",
    exitIntent: { type: "none" },
    selectedDiffFile: null,
    isDiffVisible: false,
  };
}

const states: PreviewState[] = [
  CLOSED_STATE,
  { type: "viewing-diff", session: session() },
  { type: "browsing", session: session() },
  { type: "resolving-origin", session: session() },
  { type: "checking-out", session: session() },
  { type: "previewing", session: session() },
  { type: "restoring", session: session(), fallback: "previewing" },
  { type: "returning", session: session() },
  {
    type: "switching-branch",
    appId: APP_ID,
    branch: "main",
    fallback: { type: "closed" },
  },
  {
    type: "recovery-required",
    session: session(),
    error: { message: "return failed" },
  },
];

describe("version_preview capabilities", () => {
  it("is reference-stable for the same immutable snapshot", () => {
    expect(projectVersionPreview(CLOSED_STATE)).toBe(
      projectVersionPreview(CLOSED_STATE),
    );
  });

  it("keeps restore and branch-switch controls consistent with transitions", () => {
    expect(() =>
      assertCapabilityTransitionConsistency({
        states,
        selectCapabilities: selectVersionPreviewCapabilities,
        transition,
        cases: {
          canRestore: {
            representativeEvents: (): {
              valid: PreviewEvent[];
            } => ({
              valid: [
                {
                  type: "RESTORE",
                  appId: APP_ID,
                  versionId: "v2",
                },
                {
                  type: "RESTORE_TO_MESSAGE",
                  appId: APP_ID,
                  chatId: 2,
                  messageId: 3,
                  restoreCodebase: true,
                },
              ],
            }),
            disabledReason: "invalid-in-current-state",
          },
          canSwitchBranch: {
            representativeEvents: () => ({
              valid: [
                {
                  type: "SWITCH_BRANCH",
                  appId: APP_ID,
                  branch: "main",
                } satisfies PreviewEvent,
              ],
            }),
            disabledReason: "invalid-in-current-state",
          },
        },
      }),
    ).not.toThrow();
  });

  it("disables restore during recovery while preserving explicit recovery escape", () => {
    const recovery = states.find(
      (state) => state.type === "recovery-required",
    )!;
    expect(selectVersionPreviewCapabilities(recovery)).toEqual({
      canRestore: false,
      canSwitchBranch: true,
    });
  });
});
