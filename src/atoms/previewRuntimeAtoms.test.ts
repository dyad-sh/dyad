import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  appendConsoleEntriesForAppAtom,
  clearPreviewRuntimeForAppAtom,
  currentAppUrlAtom,
  currentConsoleEntriesAtom,
  currentPreviewErrorAtom,
  currentPreviewLoadingAtom,
  previewCurrentUrlAtom,
  previewRunStateByAppIdAtom,
  setAppUrlForAppAtom,
  setPreviewErrorForAppAtom,
  setPreviewRunStateForAppAtom,
} from "@/atoms/previewRuntimeAtoms";

describe("preview runtime atoms", () => {
  it("derives current preview state from the selected app", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);

    store.set(setPreviewRunStateForAppAtom, {
      appId: 1,
      state: { operation: "run", startedAt: 100 },
    });
    store.set(appendConsoleEntriesForAppAtom, {
      appId: 2,
      entries: [
        {
          level: "info",
          type: "server",
          message: "App 2 log",
          appId: 2,
          timestamp: 200,
        },
      ],
    });

    expect(store.get(currentPreviewLoadingAtom)).toBe(true);
    expect(store.get(currentConsoleEntriesAtom)).toEqual([]);

    store.set(selectedAppIdAtom, 2);

    expect(store.get(currentPreviewLoadingAtom)).toBe(false);
    expect(
      store.get(currentConsoleEntriesAtom).map((entry) => entry.message),
    ).toEqual(["App 2 log"]);
  });

  it("clears all preview runtime state for one app", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(setPreviewRunStateForAppAtom, {
      appId: 1,
      state: { operation: "restart", startedAt: 100 },
    });
    store.set(setAppUrlForAppAtom, {
      appId: 1,
      appUrl: {
        appUrl: "http://localhost:3000",
        appId: 1,
        originalUrl: "http://localhost:3000",
        mode: "host",
      },
    });
    store.set(
      previewCurrentUrlAtom,
      new Map([[1, "http://localhost:3000/foo"]]),
    );

    expect(store.get(currentPreviewLoadingAtom)).toBe(true);
    expect(store.get(currentAppUrlAtom).appUrl).toBe("http://localhost:3000");

    store.set(clearPreviewRuntimeForAppAtom, 1);

    expect(store.get(previewRunStateByAppIdAtom).has(1)).toBe(false);
    expect(store.get(currentPreviewLoadingAtom)).toBe(false);
    expect(store.get(currentAppUrlAtom).appUrl).toBeNull();
    expect(store.get(previewCurrentUrlAtom).has(1)).toBe(false);
  });

  it("applies preview error function updates to the latest app value", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);

    store.set(setPreviewErrorForAppAtom, {
      appId: 1,
      error: {
        message: "Preview app error",
        source: "preview-app",
      },
    });
    store.set(setPreviewErrorForAppAtom, {
      appId: 1,
      error: (current) =>
        current && current.source !== "dyad-sync"
          ? current
          : {
              message: "Sync error",
              source: "dyad-sync",
            },
    });

    expect(store.get(currentPreviewErrorAtom)).toEqual({
      message: "Preview app error",
      source: "preview-app",
    });
  });
});
