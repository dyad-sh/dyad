import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  appendConsoleEntriesForAppAtom,
  clearPreviewRuntimeForAppAtom,
  currentAppUrlAtom,
  currentConsoleEntriesAtom,
  currentPackageManagerWarningAtom,
  currentPreviewErrorAtom,
  currentPreviewLoadingAtom,
  dismissPackageManagerWarningForAppAtom,
  previewCurrentUrlAtom,
  previewRunStateByAppIdAtom,
  setAppUrlForAppAtom,
  setPackageManagerWarningForAppAtom,
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
    store.set(setPackageManagerWarningForAppAtom, {
      appId: 1,
      warning: { message: "Install pnpm 10.16.0 or newer" },
    });

    expect(store.get(currentPreviewLoadingAtom)).toBe(true);
    expect(store.get(currentAppUrlAtom).appUrl).toBe("http://localhost:3000");
    expect(store.get(currentPackageManagerWarningAtom)).toEqual({
      message: "Install pnpm 10.16.0 or newer",
      appId: 1,
    });

    store.set(clearPreviewRuntimeForAppAtom, 1);

    expect(store.get(previewRunStateByAppIdAtom).has(1)).toBe(false);
    expect(store.get(currentPreviewLoadingAtom)).toBe(false);
    expect(store.get(currentAppUrlAtom).appUrl).toBeNull();
    expect(store.get(currentPackageManagerWarningAtom)).toEqual({
      message: "Install pnpm 10.16.0 or newer",
      appId: 1,
    });
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

  it("keeps package manager warning dismissal scoped to the Dyad session", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(setPackageManagerWarningForAppAtom, {
      appId: 1,
      warning: { message: "Install pnpm 10.16.0 or newer" },
    });

    store.set(dismissPackageManagerWarningForAppAtom);
    store.set(setPackageManagerWarningForAppAtom, {
      appId: 2,
      warning: { message: "Install pnpm 10.16.0 or newer" },
    });

    expect(store.get(currentPackageManagerWarningAtom)).toBeUndefined();
  });
});
