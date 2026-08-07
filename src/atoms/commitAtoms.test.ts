import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { isPreviewOpenAtom, stagedDiffFileAtom } from "@/atoms/viewAtoms";
import {
  clearStagedDiffAtom,
  closeCommitDialogAtom,
  commitMessageDraftAtom,
  commitMessageDraftsByAppIdAtom,
  discardCommitMessageDraftAtom,
  exitStagedDiffAtom,
  openCommitDialogAtom,
  openStagedDiffAtom,
  resetCommitDialogAtom,
  type CommitDialogSource,
} from "@/atoms/commitAtoms";

const APP = 1;
const OTHER_APP = 2;

/**
 * The staged-diff round trip these atoms exist for: a dialog is open, the user
 * clicks a file in it, and the diff opens with a pending return to that dialog.
 */
function openDiffFrom(
  store: ReturnType<typeof createStore>,
  source: CommitDialogSource,
  appId = APP,
) {
  store.set(selectedAppIdAtom, appId);
  store.set(openCommitDialogAtom, { source, appId });
  store.set(openStagedDiffAtom, {
    path: "src/a.ts",
    returnTo: { source, appId },
  });
}

describe("commit dialog atoms", () => {
  describe("openStagedDiffAtom", () => {
    it("swaps the dialog for the diff and reveals the code panel", () => {
      const store = createStore();
      store.set(previewModeAtom, "preview");
      store.set(isPreviewOpenAtom, false);
      store.set(openCommitDialogAtom, { source: "editor", appId: APP });

      store.set(openStagedDiffAtom, {
        path: "src/a.ts",
        returnTo: { source: "editor", appId: APP },
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
      expect(store.get(openCommitDialogAtom)).toEqual({
        source: "banner",
        appId: APP,
      });
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

      store.set(clearStagedDiffAtom, APP);

      expect(store.get(stagedDiffFileAtom)).toBeNull();
      expect(store.get(openCommitDialogAtom)).toBeNull();
      // The return target is gone too: a later exit must not resurrect it.
      store.set(exitStagedDiffAtom);
      expect(store.get(openCommitDialogAtom)).toBeNull();
    });

    it("discards the draft, which cannot outlive the round trip", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, APP);
      store.set(openCommitDialogAtom, { source: "editor", appId: APP });
      store.set(commitMessageDraftAtom, "Fix login redirect");
      store.set(openStagedDiffAtom, {
        path: "src/a.ts",
        returnTo: { source: "editor", appId: APP },
      });

      // Editing the file from the diff is the path with no way back.
      store.set(clearStagedDiffAtom, APP);

      expect(store.get(commitMessageDraftAtom)).toBeNull();
    });

    it("does nothing once the user has moved to another app", () => {
      const store = createStore();
      openDiffFrom(store, "banner");
      // A commit for app 1 resolves after the user switched to app 2 and
      // started their own diff and message there.
      store.set(selectedAppIdAtom, OTHER_APP);
      store.set(stagedDiffFileAtom, "src/b.ts");
      store.set(commitMessageDraftAtom, "Add settings page");

      store.set(clearStagedDiffAtom, APP);

      expect(store.get(stagedDiffFileAtom)).toBe("src/b.ts");
      expect(store.get(commitMessageDraftAtom)).toBe("Add settings page");
    });

    it("does nothing without an app to scope to", () => {
      const store = createStore();
      openDiffFrom(store, "editor");

      store.set(clearStagedDiffAtom, null);

      expect(store.get(stagedDiffFileAtom)).toBe("src/a.ts");
    });
  });

  describe("closeCommitDialogAtom", () => {
    it("closes the dialog and discards its draft", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, APP);
      store.set(openCommitDialogAtom, { source: "editor", appId: APP });
      store.set(commitMessageDraftAtom, "Fix login redirect");

      store.set(closeCommitDialogAtom, { source: "editor", appId: APP });

      expect(store.get(openCommitDialogAtom)).toBeNull();
      expect(store.get(commitMessageDraftAtom)).toBeNull();
    });

    it("drops the pending return, so the back arrow cannot resurrect it", () => {
      const store = createStore();
      // Open the diff from the dialog, then reopen the dialog from its own
      // button on top of the diff, then cancel it.
      openDiffFrom(store, "editor");
      store.set(openCommitDialogAtom, { source: "editor", appId: APP });

      store.set(closeCommitDialogAtom, { source: "editor", appId: APP });
      store.set(exitStagedDiffAtom);

      expect(store.get(openCommitDialogAtom)).toBeNull();
      expect(store.get(stagedDiffFileAtom)).toBeNull();
    });

    it("drops a pending return when its host can no longer render it", () => {
      const store = createStore();
      // The banner is unmounted by ChatHeader while streaming, mid round trip.
      openDiffFrom(store, "banner");
      store.set(commitMessageDraftAtom, "Fix login redirect");

      store.set(closeCommitDialogAtom, { source: "banner", appId: APP });

      // Nothing renders that dialog now, so neither the back arrow nor a later
      // reopen may find its way back to it - message included.
      store.set(exitStagedDiffAtom);
      expect(store.get(openCommitDialogAtom)).toBeNull();
      expect(store.get(commitMessageDraftAtom)).toBeNull();
    });

    it("leaves the staged diff showing", () => {
      const store = createStore();
      openDiffFrom(store, "banner");

      store.set(closeCommitDialogAtom, { source: "banner", appId: APP });

      expect(store.get(stagedDiffFileAtom)).toBe("src/a.ts");
    });

    it("leaves the other source's dialog and pending return alone", () => {
      const store = createStore();
      openDiffFrom(store, "editor");
      store.set(openCommitDialogAtom, { source: "editor", appId: APP });

      store.set(closeCommitDialogAtom, { source: "banner", appId: APP });

      expect(store.get(openCommitDialogAtom)).toEqual({
        source: "editor",
        appId: APP,
      });
      store.set(openCommitDialogAtom, null);
      store.set(exitStagedDiffAtom);
      expect(store.get(openCommitDialogAtom)).toEqual({
        source: "editor",
        appId: APP,
      });
    });

    it("leaves the draft alone when it owns neither the dialog nor a return", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, APP);
      // The user is typing in the banner's dialog when a plan:update event
      // flips previewMode and unmounts CodeView, taking the commit menu with
      // it. The two sources share one draft per app, so this must not empty
      // the input in front of the user.
      store.set(openCommitDialogAtom, { source: "banner", appId: APP });
      store.set(commitMessageDraftAtom, "Fix login redirect");

      store.set(closeCommitDialogAtom, { source: "editor", appId: APP });

      expect(store.get(commitMessageDraftAtom)).toBe("Fix login redirect");
      expect(store.get(openCommitDialogAtom)).toEqual({
        source: "banner",
        appId: APP,
      });
    });

    it("leaves the same source's dialog for another app alone", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, OTHER_APP);
      // The user switched apps and opened a new banner dialog before app 1's
      // commit finished.
      store.set(openCommitDialogAtom, { source: "banner", appId: OTHER_APP });
      store.set(commitMessageDraftAtom, "Add settings page");

      store.set(closeCommitDialogAtom, { source: "banner", appId: APP });

      expect(store.get(openCommitDialogAtom)).toEqual({
        source: "banner",
        appId: OTHER_APP,
      });
      expect(store.get(commitMessageDraftAtom)).toBe("Add settings page");
    });
  });

  describe("resetCommitDialogAtom", () => {
    it("drops the dialog and pending return without touching the diff", () => {
      const store = createStore();
      openDiffFrom(store, "editor");
      store.set(openCommitDialogAtom, { source: "editor", appId: APP });

      store.set(resetCommitDialogAtom);

      expect(store.get(openCommitDialogAtom)).toBeNull();
      expect(store.get(stagedDiffFileAtom)).toBe("src/a.ts");
      store.set(exitStagedDiffAtom);
      expect(store.get(openCommitDialogAtom)).toBeNull();
    });

    it("keeps the draft, which is per-app and survives switching back", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, APP);
      store.set(commitMessageDraftAtom, "Fix login redirect");

      store.set(resetCommitDialogAtom);

      expect(store.get(commitMessageDraftAtom)).toBe("Fix login redirect");
    });
  });

  describe("commitMessageDraftAtom", () => {
    it("reads and writes the selected app's entry", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, APP);
      store.set(commitMessageDraftAtom, "Fix login redirect");
      store.set(selectedAppIdAtom, OTHER_APP);

      expect(store.get(commitMessageDraftAtom)).toBeNull();

      store.set(commitMessageDraftAtom, "Add settings page");
      store.set(selectedAppIdAtom, APP);

      expect(store.get(commitMessageDraftAtom)).toBe("Fix login redirect");
    });

    it("deletes the entry when written null", () => {
      const store = createStore();
      store.set(selectedAppIdAtom, APP);
      store.set(commitMessageDraftAtom, "Fix login redirect");

      store.set(commitMessageDraftAtom, null);

      expect(store.get(commitMessageDraftAtom)).toBeNull();
      expect(store.get(commitMessageDraftsByAppIdAtom).has(APP)).toBe(false);
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
      store.set(selectedAppIdAtom, APP);
      store.set(commitMessageDraftAtom, "Fix login redirect");
      store.set(selectedAppIdAtom, OTHER_APP);
      store.set(commitMessageDraftAtom, "Add settings page");

      store.set(discardCommitMessageDraftAtom, APP);

      expect(store.get(commitMessageDraftAtom)).toBe("Add settings page");
      expect(store.get(commitMessageDraftsByAppIdAtom).has(APP)).toBe(false);
    });

    it("keeps the map identity when there is nothing to delete", () => {
      const store = createStore();
      const before = store.get(commitMessageDraftsByAppIdAtom);

      store.set(discardCommitMessageDraftAtom, APP);

      expect(store.get(commitMessageDraftsByAppIdAtom)).toBe(before);
    });
  });
});
