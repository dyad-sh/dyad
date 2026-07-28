import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ userData: "" }));
vi.mock("@/paths/paths", () => ({
  getUserDataPath: () => paths.userData,
}));

import { versionPreviewPersistence } from "./version_preview_persistence";

const session = {
  appId: 7,
  originBranch: "feature/origin",
  targetVersionId: "abc123",
  checkedOutVersionId: "abc123",
  exitIntent: { type: "none" as const },
  selectedDiffFile: { versionId: "abc123", path: "src/App.tsx" },
  isDiffVisible: true,
};

describe("version preview persistence", () => {
  beforeEach(() => {
    paths.userData = fs.mkdtempSync(
      path.join(os.tmpdir(), "dyad-version-persistence-"),
    );
  });

  afterEach(() => {
    fs.rmSync(paths.userData, { recursive: true, force: true });
  });

  it("retains the recovery fallback while a branch switch is in flight", () => {
    versionPreviewPersistence.checkpoint(7, {
      type: "switching-branch",
      appId: 7,
      branch: "other",
      fallback: { type: "previewing", session },
    });

    expect(versionPreviewPersistence.load(7)).toEqual({
      type: "switching-branch",
      appId: 7,
      branch: "other",
      fallback: {
        type: "previewing",
        session: {
          ...session,
          selectedDiffFile: null,
          isDiffVisible: false,
        },
      },
    });
  });

  it("retains whether an interrupted restore began on the live branch", () => {
    const restoring = {
      type: "restoring",
      session: {
        ...session,
        originBranch: null,
        checkedOutVersionId: null,
      },
      fallback: "closed",
    } as const;
    versionPreviewPersistence.checkpointRestore(7, restoring, {
      preRestoreHead: "live-head",
      targetHead: "abc123",
      nextStep: "soft-reset",
    });

    expect(versionPreviewPersistence.load(7)).toMatchObject({
      type: "restoring",
      fallback: "closed",
      session: { originBranch: null, checkedOutVersionId: null },
      restoreRecovery: {
        preRestoreHead: "live-head",
        targetHead: "abc123",
        nextStep: "soft-reset",
      },
    });
  });

  it("fails closed on corrupt checkpoints instead of treating them as idle", () => {
    const directory = path.join(paths.userData, "state-machines");
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(
      path.join(directory, "version-preview-7.json"),
      "{not json",
    );

    expect(() => versionPreviewPersistence.load(7)).toThrow();
  });

  it("clears only version-preview checkpoints during reset", () => {
    versionPreviewPersistence.checkpoint(7, {
      type: "previewing",
      session,
    });
    const directory = path.join(paths.userData, "state-machines");
    fs.writeFileSync(path.join(directory, "other-machine.json"), "{}");

    versionPreviewPersistence.removeAll();

    expect(versionPreviewPersistence.load(7)).toEqual({ type: "closed" });
    expect(fs.existsSync(path.join(directory, "other-machine.json"))).toBe(
      true,
    );
  });
});
