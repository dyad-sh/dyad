import type { PropsWithChildren } from "react";
import { Provider, createStore } from "jotai";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { stagedDiffFileAtom } from "@/atoms/viewAtoms";
import {
  commitMessageDraftAtom,
  openCommitDialogAtom,
  openStagedDiffAtom,
  type CommitDialogSource,
} from "@/atoms/commitAtoms";

import { useCommitDialogRecovery } from "./useCommitDialogRecovery";

const APP = 1;
const FILE = "src/a.ts";

const commitMocks = vi.hoisted(() => ({
  commitChanges: vi.fn(async () => "ok"),
  resetCommitError: vi.fn(),
  preCommitError: null as { message: string } | null,
}));

const aiFixMocks = vi.hoisted(() => ({
  fixPreCommitWithAI: vi.fn(async () => true),
  isStarting: false,
  isAvailabilityLoading: false,
  unavailableReason: null as string | null,
}));

vi.mock("@/hooks/useCommitChanges", () => ({
  useCommitChanges: () => ({
    commitChanges: commitMocks.commitChanges,
    cancelCommit: vi.fn(),
    isCommitting: false,
    isCancellingCommit: false,
    commitProgress: null,
    preCommitError: commitMocks.preCommitError,
    prepareCommitMsgError: null,
    commitMsgError: null,
    commitError: null,
    resetCommitError: commitMocks.resetCommitError,
  }),
}));

vi.mock("@/hooks/useFixPreCommitWithAI", () => ({
  useFixPreCommitWithAI: () => ({
    fixPreCommitWithAI: aiFixMocks.fixPreCommitWithAI,
    isStarting: aiFixMocks.isStarting,
    isAvailable: true,
    isAvailabilityLoading: aiFixMocks.isAvailabilityLoading,
    unavailableReason: aiFixMocks.unavailableReason,
  }),
}));

function makeWrapper(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

/**
 * Seeds the store with the UI sequence that leaves a staged diff open behind a
 * re-opened commit dialog — the state `stagedDiffFileAtom` is non-null in when
 * an end-of-life path runs: open dialog -> open a file's diff (dialog closes,
 * diff opens) -> re-open the dialog on top of the still-open diff.
 */
function seedReopenedOnTopOfDiff(
  store: ReturnType<typeof createStore>,
  source: CommitDialogSource,
  appId = APP,
  path = FILE,
) {
  store.set(selectedAppIdAtom, appId);
  store.set(openCommitDialogAtom, { source, appId });
  store.set(openStagedDiffAtom, { path, returnTo: { source, appId } });
  store.set(openCommitDialogAtom, { source, appId });
}

describe("useCommitDialogRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commitMocks.preCommitError = null;
    commitMocks.commitChanges.mockResolvedValue("ok");
    aiFixMocks.fixPreCommitWithAI.mockResolvedValue(true);
  });

  // The three end-of-life paths for the commit dialog each own a distinct
  // cleanup contract. These tests pin that contract so the asymmetry that
  // caused the "Fix with AI" staged-diff leak cannot silently return: a path
  // that routes the user away (commit, AI fix) must clear the staged diff,
  // and one that does not (dismiss) must leave it showing.

  it("handleFixPreCommitWithAI clears the staged diff when routing to the agent chat", async () => {
    const store = createStore();
    seedReopenedOnTopOfDiff(store, "banner");
    commitMocks.preCommitError = { message: "lint failed" };

    const { result } = renderHook(
      () =>
        useCommitDialogRecovery({
          appId: APP,
          source: "banner",
          commitMessage: "Save checkout fix",
          onDialogEnded: vi.fn(),
        }),
      { wrapper: makeWrapper(store) },
    );

    let started = false;
    await act(async () => {
      started = await result.current.handleFixPreCommitWithAI();
    });

    expect(started).toBe(true);
    expect(store.get(openCommitDialogAtom)).toBeNull();
    // The diff the dialog was re-opened on top of is cleared, so the code
    // panel falls back to the editor alongside the agent chat — matching
    // the handleCommit / handleDiscard end-of-life cleanup.
    expect(store.get(stagedDiffFileAtom)).toBeNull();
  });

  it("handleFixPreCommitWithAI leaves the diff untouched when the AI fix fails to start", async () => {
    const store = createStore();
    seedReopenedOnTopOfDiff(store, "banner");
    commitMocks.preCommitError = { message: "lint failed" };
    aiFixMocks.fixPreCommitWithAI.mockResolvedValue(false);

    const { result } = renderHook(
      () =>
        useCommitDialogRecovery({
          appId: APP,
          source: "banner",
          commitMessage: "Save checkout fix",
        }),
      { wrapper: makeWrapper(store) },
    );

    let started = true;
    await act(async () => {
      started = await result.current.handleFixPreCommitWithAI();
    });

    expect(started).toBe(false);
    // No fix started, so the cleanup tail never ran: the dialog and diff
    // stay as the user left them. Guards against hoisting clearStagedDiff
    // above the early return.
    expect(store.get(openCommitDialogAtom)).toEqual({
      source: "banner",
      appId: APP,
    });
    expect(store.get(stagedDiffFileAtom)).toBe(FILE);
  });

  it("handleCommit clears the staged diff on the commit-success path", async () => {
    const store = createStore();
    seedReopenedOnTopOfDiff(store, "banner");

    const { result } = renderHook(
      () =>
        useCommitDialogRecovery({
          appId: APP,
          source: "banner",
          commitMessage: "Save checkout fix",
        }),
      { wrapper: makeWrapper(store) },
    );

    let committed = false;
    await act(async () => {
      committed = await result.current.handleCommit();
    });

    expect(committed).toBe(true);
    expect(store.get(openCommitDialogAtom)).toBeNull();
    expect(store.get(stagedDiffFileAtom)).toBeNull();
  });

  it("dismissDialog closes the dialog but leaves the staged diff showing", () => {
    const store = createStore();
    seedReopenedOnTopOfDiff(store, "banner");

    const { result } = renderHook(
      () =>
        useCommitDialogRecovery({
          appId: APP,
          source: "banner",
          commitMessage: "Save checkout fix",
        }),
      { wrapper: makeWrapper(store) },
    );

    act(() => {
      result.current.dismissDialog();
    });

    // The dialog is gone and its draft is discarded.
    expect(store.get(openCommitDialogAtom)).toBeNull();
    expect(store.get(commitMessageDraftAtom)).toBeNull();
    // But the diff stays: dismiss routes the user nowhere, so a staged diff
    // the user opened remains the code-panel view. This is the
    // closeCommitDialogAtom "leaves the staged diff showing" guarantee, and
    // the reason dismiss must not call clearStagedDiff.
    expect(store.get(stagedDiffFileAtom)).toBe(FILE);
  });
});
