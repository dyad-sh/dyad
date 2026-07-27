import { describe, expect, it } from "vitest";
import {
  combineVersionPreviewState,
  VersionPreviewPresentationStore,
} from "./presentation_store";

describe("version preview presentation composition", () => {
  it("retains a window-local diff selection across remote checkout states", () => {
    const presentation = new VersionPreviewPresentationStore();
    presentation.send(7, { type: "OPEN", appId: 7 });
    presentation.send(7, {
      type: "SELECT_VERSION",
      versionId: "abc123",
    });

    const state = combineVersionPreviewState(
      7,
      {
        type: "checking-out",
        session: {
          appId: 7,
          originBranch: "main",
          targetVersionId: "abc123",
          checkedOutVersionId: null,
          exitIntent: { type: "none" },
          selectedDiffFile: null,
          isDiffVisible: false,
        },
      },
      presentation.getSnapshot(7),
    );

    expect(state).toMatchObject({
      type: "checking-out",
      session: {
        targetVersionId: "abc123",
        isDiffVisible: true,
      },
    });
  });

  it("hides local presentation while returning or recovering", () => {
    const presentation = new VersionPreviewPresentationStore();
    presentation.send(7, {
      type: "SELECT_VERSION",
      versionId: "abc123",
    });
    const session = {
      appId: 7,
      originBranch: "main",
      targetVersionId: "abc123",
      checkedOutVersionId: "abc123",
      exitIntent: { type: "close" as const },
      selectedDiffFile: null,
      isDiffVisible: false,
    };

    expect(
      combineVersionPreviewState(
        7,
        { type: "returning", session },
        presentation.getSnapshot(7),
      ),
    ).toEqual({ type: "returning", session });
  });

  it("keeps another window's pane closed during remote preview activity", () => {
    const presentation = new VersionPreviewPresentationStore();
    const session = {
      appId: 7,
      originBranch: "main",
      targetVersionId: "abc123",
      checkedOutVersionId: null,
      exitIntent: { type: "none" as const },
      selectedDiffFile: null,
      isDiffVisible: false,
    };

    expect(presentation.isPaneVisible(7)).toBe(false);
    expect(
      combineVersionPreviewState(
        7,
        { type: "checking-out", session },
        presentation.getSnapshot(7),
      ),
    ).toMatchObject({
      type: "checking-out",
      session: { isDiffVisible: false },
    });
    expect(presentation.isPaneVisible(7)).toBe(false);
  });

  it("does not overlay a diff for a different authoritative version", () => {
    const presentation = new VersionPreviewPresentationStore();
    presentation.send(7, {
      type: "SELECT_VERSION",
      versionId: "rejected-version",
    });

    const state = combineVersionPreviewState(
      7,
      {
        type: "previewing",
        session: {
          appId: 7,
          originBranch: "main",
          targetVersionId: "accepted-version",
          checkedOutVersionId: "accepted-version",
          exitIntent: { type: "none" },
          selectedDiffFile: null,
          isDiffVisible: false,
        },
      },
      presentation.getSnapshot(7),
    );

    expect(state).toMatchObject({
      type: "previewing",
      session: { isDiffVisible: false, selectedDiffFile: null },
    });
  });
});
