import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { isPreviewOpenAtom, stagedDiffFileAtom } from "@/atoms/viewAtoms";
import {
  clearStagedDiffAtom,
  commitMessageDraftAtom,
  commitMessageDraftsByAppIdAtom,
  discardCommitMessageDraftAtom,
  dismissCommitDialogAtom,
  exitStagedDiffAtom,
  openCommitDialogAtom,
  openStagedDiffAtom,
  releaseCommitDialogAtom,
  resetCommitDialogAtom,
} from "@/atoms/commitAtoms";

/**
 * The staged-diff round trip these atoms exist for: a dialog is open, the user
 * clicks a file in it, and the diff opens with a pending return to that dialog.
 */
function openDiffFrom(
  store: ReturnType<typeof createStore>,
  source: "editor" | "banner",
) {
  store.set(openCommitDialogAtom, source);
  store.set(openStagedDiffAtom, { path: "src/a.ts", returnTo: source });
}

describe("commit dialog atoms", () => {
  describe("openStagedDiffAtom", () => {
    it("swaps the dialog for the diff and reveals the code panel", () => {
      const store = createStore();
      store.set(previewModeAtom, "preview");
      store.set(isPreviewOpenAtom, false);
      store.set(openCommitDialogAtom, "editor");

      store.set(openStagedDiffAtom, {
        path: "src/a.ts",
        returnTo: "editor",
      });

      expect(store.get(openCommitDialogAtom)).toBeNull();
      expect(store.get(stagedDiffFileAtom)).toBe("src/a.ts");
      expect(store.get(previewModeAtom)).toBe("code");
      expect(store.get(isPreviewOpenAtom)).toBe(true);
    });
  });

  describe("exitStagedDiffAtom", () => {
    it("reopens the dialog the diff was opened from", () => {
      const store = createStore();
      openDiffFrom(store, "banner");

      store.set(exitStagedDiffAtom);

      expect(store.get(stagedDiffFileAtom)).toBeNull();
      expect(store.get(openCommitDialogAtom)).toBe("banner");
    });

    it("opens nothing when the diff was not opened from a dialog", () => {
      const store = createStore();
      // The commit menu's dropdown is a shortcut straight to a diff.
      store.set(openStagedDiffAtom, { path: "src/a.ts", returnTo: null });

      store.set(exitStagedDiffAtom);

      expect(store.get(stagedDiffFileAtom)).toBeNull();
      expect(store.get(openCommitDialogAtom)).toBeNull();
    });

    it("consumes the return target so a second exit reopens nothing", () => {
      const store = createStore();
      openDiffFrom(store, "editor");

      store.set(exitStagedDiffAtom);
      store.set(openCommitDialogAtom, null);
      store.set(exitStagedDiffAtom);

      expect(store.get(openCommitDialogAtom)).toBeNull();
    });
  });

  describe("clearStagedDiffAtom", () => {
    it("leaves the diff without reopening the dialog behind it", () => {
      const store = createStore();
      openDiffFrom(store, "editor");

      store.set(clearStagedDiffAtom);

      expect(store.get(stagedDiffFileAtom)).toBeNull();
      expect(store.get(openCommitDialogAtom)).toBeNull();
      // The return target is gone too: a later exit must not resurrect it.
      store.set(exitStagedDiffAtom);
      expect(store.get(openCommitDialogAtom)).toBeNull();
    });

    it("discards the draft, which cannot outlive the round trip", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, 1);
      store.set(openCommitDialogAtom, "editor");
      store.set(commitMessageDraftAtom, "Fix login redirect");
      store.set(openStagedDiffAtom, { path: "src/a.ts", returnTo: "editor" });

      // Editing the file from the diff is the path with no way back.
      store.set(clearStagedDiffAtom);

      expect(store.get(commitMessageDraftAtom)).toBeNull();
    });
  });

  describe("releaseCommitDialogAtom", () => {
    it("closes only the releasing source's dialog", () => {
      const store = createStore();
      store.set(openCommitDialogAtom, "editor");

      store.set(releaseCommitDialogAtom, "banner");

      expect(store.get(openCommitDialogAtom)).toBe("editor");

      store.set(releaseCommitDialogAtom, "editor");

      expect(store.get(openCommitDialogAtom)).toBeNull();
    });

    it("drops a pending return only when the releasing source owns it", () => {
      const store = createStore();
      openDiffFrom(store, "editor");

      store.set(releaseCommitDialogAtom, "banner");
      store.set(exitStagedDiffAtom);

      expect(store.get(openCommitDialogAtom)).toBe("editor");
    });

    it("drops its own pending return so the back arrow cannot reach it", () => {
      const store = createStore();
      openDiffFrom(store, "banner");

      store.set(releaseCommitDialogAtom, "banner");
      store.set(exitStagedDiffAtom);

      expect(store.get(openCommitDialogAtom)).toBeNull();
    });

    it("leaves the staged diff showing", () => {
      const store = createStore();
      openDiffFrom(store, "banner");

      store.set(releaseCommitDialogAtom, "banner");

      expect(store.get(stagedDiffFileAtom)).toBe("src/a.ts");
    });
  });

  describe("resetCommitDialogAtom", () => {
    it("drops the dialog and pending return without touching the diff", () => {
      const store = createStore();
      openDiffFrom(store, "editor");
      store.set(openCommitDialogAtom, "editor");

      store.set(resetCommitDialogAtom);

      expect(store.get(openCommitDialogAtom)).toBeNull();
      expect(store.get(stagedDiffFileAtom)).toBe("src/a.ts");
      store.set(exitStagedDiffAtom);
      expect(store.get(openCommitDialogAtom)).toBeNull();
    });

    it("keeps the draft, which is per-app and survives switching back", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, 1);
      store.set(commitMessageDraftAtom, "Fix login redirect");

      store.set(resetCommitDialogAtom);

      expect(store.get(commitMessageDraftAtom)).toBe("Fix login redirect");
    });
  });

  describe("dismissCommitDialogAtom", () => {
    it("closes the dialog and discards its draft", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, 1);
      store.set(openCommitDialogAtom, "editor");
      store.set(commitMessageDraftAtom, "Fix login redirect");

      store.set(dismissCommitDialogAtom, { source: "editor", appId: 1 });

      expect(store.get(openCommitDialogAtom)).toBeNull();
      expect(store.get(commitMessageDraftAtom)).toBeNull();
    });

    it("drops the pending return, so the back arrow cannot resurrect it", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, 1);
      // Open the diff from the dialog, then reopen the dialog from its own
      // button on top of the diff, then cancel it.
      openDiffFrom(store, "editor");
      store.set(openCommitDialogAtom, "editor");

      store.set(dismissCommitDialogAtom, { source: "editor", appId: 1 });
      store.set(exitStagedDiffAtom);

      expect(store.get(openCommitDialogAtom)).toBeNull();
      expect(store.get(stagedDiffFileAtom)).toBeNull();
    });

    it("leaves the other source's dialog and draft alone", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, 2);
      store.set(openCommitDialogAtom, "banner");
      store.set(commitMessageDraftAtom, "Add settings page");

      // A commit started from the editor dialog for app 1 resolving late.
      store.set(dismissCommitDialogAtom, { source: "editor", appId: 1 });

      expect(store.get(openCommitDialogAtom)).toBe("banner");
      expect(store.get(commitMessageDraftAtom)).toBe("Add settings page");
    });

    it("is a no-op on the draft before an app is selected", () => {
      const store = createStore();
      store.set(openCommitDialogAtom, "banner");

      store.set(dismissCommitDialogAtom, { source: "banner", appId: null });

      expect(store.get(openCommitDialogAtom)).toBeNull();
    });
  });

  describe("commitMessageDraftAtom", () => {
    it("reads and writes the selected app's entry", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, 1);
      store.set(commitMessageDraftAtom, "Fix login redirect");
      store.set(selectedAppIdAtom, 2);

      expect(store.get(commitMessageDraftAtom)).toBeNull();

      store.set(commitMessageDraftAtom, "Add settings page");
      store.set(selectedAppIdAtom, 1);

      expect(store.get(commitMessageDraftAtom)).toBe("Fix login redirect");
    });

    it("deletes the entry when written null", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, 1);
      store.set(commitMessageDraftAtom, "Fix login redirect");

      store.set(commitMessageDraftAtom, null);

      expect(store.get(commitMessageDraftAtom)).toBeNull();
      expect(store.get(commitMessageDraftsByAppIdAtom).has(1)).toBe(false);
    });

    it("is a no-op before an app is selected", () => {
      const store = createStore();

      store.set(commitMessageDraftAtom, "Fix login redirect");

      expect(store.get(commitMessageDraftsByAppIdAtom).size).toBe(0);
      expect(store.get(commitMessageDraftAtom)).toBeNull();
    });
  });

  describe("discardCommitMessageDraftAtom", () => {
    it("deletes by app id rather than by the selected app", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, 1);
      store.set(commitMessageDraftAtom, "Fix login redirect");
      store.set(selectedAppIdAtom, 2);
      store.set(commitMessageDraftAtom, "Add settings page");

      store.set(discardCommitMessageDraftAtom, 1);

      expect(store.get(commitMessageDraftAtom)).toBe("Add settings page");
      expect(store.get(commitMessageDraftsByAppIdAtom).has(1)).toBe(false);
    });

    it("keeps the map identity when there is nothing to delete", () => {
      const store = createStore();
      const before = store.get(commitMessageDraftsByAppIdAtom);

      store.set(discardCommitMessageDraftAtom, 1);

      expect(store.get(commitMessageDraftsByAppIdAtom)).toBe(before);
    });
  });
});
