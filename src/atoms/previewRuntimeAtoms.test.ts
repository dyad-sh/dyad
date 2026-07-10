import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import type { ConsoleEntry } from "@/ipc/types";
import {
  appendConsoleEntriesForAppAtom,
  clearPreviewRuntimeForAppAtom,
  consoleEntriesByAppIdAtom,
  currentAppUrlAtom,
  currentConsoleEntriesAtom,
  currentPackageManagerWarningAtom,
  currentPreviewErrorAtom,
  currentPreviewLoadingAtom,
  dismissPackageManagerWarningsAtom,
  previewCurrentUrlAtom,
  previewRunStateByAppIdAtom,
  setAppUrlForAppAtom,
  setPackageManagerWarningForAppAtom,
  setConsoleEntriesForAppAtom,
  setPreviewErrorForAppAtom,
  setPreviewRunStateForAppAtom,
} from "@/atoms/previewRuntimeAtoms";
import {
  getPreviewConsoleEntryByteLength,
  MAX_PREVIEW_CONSOLE_BYTES_PER_APP,
  MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP,
  MAX_PREVIEW_CONSOLE_MESSAGE_BYTES,
  MAX_PREVIEW_CONSOLE_SOURCE_NAME_BYTES,
  PREVIEW_CONSOLE_OMISSION_MESSAGE,
} from "@/lib/preview_console_buffer";

function consoleEntry(
  message: string,
  timestamp: number,
  appId = 1,
  sourceName?: string,
): ConsoleEntry {
  return {
    level: "info",
    type: "server",
    message,
    timestamp,
    appId,
    sourceName,
  };
}

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

  it("keeps the newest entries when a batch exceeds the count limit", () => {
    const store = createStore();
    const entries = Array.from(
      { length: MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP + 2 },
      (_, index) => consoleEntry(`log-${index}`, index),
    );

    store.set(appendConsoleEntriesForAppAtom, { appId: 1, entries });

    const retained = store.get(consoleEntriesByAppIdAtom).get(1) ?? [];
    expect(retained).toHaveLength(MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP);
    expect(retained[0].message).toBe(PREVIEW_CONSOLE_OMISSION_MESSAGE);
    expect(retained[1].message).toBe("log-3");
    expect(retained[0].timestamp).toBe(retained[1].timestamp);
    expect(retained.at(-1)?.message).toBe(
      `log-${MAX_PREVIEW_CONSOLE_ENTRIES_PER_APP + 1}`,
    );
  });

  it("keeps the newest entries within the UTF-8 byte budget", () => {
    const store = createStore();
    const entryCount =
      Math.floor(
        MAX_PREVIEW_CONSOLE_BYTES_PER_APP / MAX_PREVIEW_CONSOLE_MESSAGE_BYTES,
      ) + 2;
    const entries = Array.from({ length: entryCount }, (_, index) =>
      consoleEntry("x".repeat(MAX_PREVIEW_CONSOLE_MESSAGE_BYTES), index),
    );

    store.set(appendConsoleEntriesForAppAtom, { appId: 1, entries });

    const retained = store.get(consoleEntriesByAppIdAtom).get(1) ?? [];
    const retainedBytes = retained.reduce(
      (total, entry) => total + getPreviewConsoleEntryByteLength(entry),
      0,
    );
    expect(retainedBytes).toBeLessThanOrEqual(
      MAX_PREVIEW_CONSOLE_BYTES_PER_APP,
    );
    expect(retained[0].message).toBe(PREVIEW_CONSOLE_OMISSION_MESSAGE);
    expect(retained.at(-1)?.timestamp).toBe(entryCount - 1);
  });

  it("truncates a giant multibyte entry and source with explicit markers", () => {
    const store = createStore();
    store.set(appendConsoleEntriesForAppAtom, {
      appId: 1,
      entries: [
        consoleEntry(
          "🙂".repeat(MAX_PREVIEW_CONSOLE_MESSAGE_BYTES),
          1,
          1,
          "源".repeat(MAX_PREVIEW_CONSOLE_SOURCE_NAME_BYTES),
        ),
      ],
    });

    const [retained] = store.get(consoleEntriesByAppIdAtom).get(1) ?? [];
    expect(getPreviewConsoleEntryByteLength(retained)).toBeLessThanOrEqual(
      MAX_PREVIEW_CONSOLE_MESSAGE_BYTES + MAX_PREVIEW_CONSOLE_SOURCE_NAME_BYTES,
    );
    expect(retained.message).toContain("[log payload truncated]");
    expect(retained.sourceName).toContain("[source truncated]");
    const retainedPrefix = retained.message.slice(
      0,
      retained.message.indexOf("\n… [log payload truncated]"),
    );
    expect(retainedPrefix.endsWith("🙂")).toBe(true);
  });

  it("preserves delivery order across append batches", () => {
    const store = createStore();
    store.set(appendConsoleEntriesForAppAtom, {
      appId: 1,
      entries: [consoleEntry("first", 300), consoleEntry("second", 100)],
    });
    store.set(appendConsoleEntriesForAppAtom, {
      appId: 1,
      entries: [consoleEntry("third", 200), consoleEntry("fourth", 50)],
    });

    expect(
      (store.get(consoleEntriesByAppIdAtom).get(1) ?? []).map(
        (entry) => entry.message,
      ),
    ).toEqual(["first", "second", "third", "fourth"]);
  });

  it("removes the per-app buffer when logs are reset", () => {
    const store = createStore();
    store.set(setConsoleEntriesForAppAtom, {
      appId: 1,
      entries: [consoleEntry("before reset", 1)],
    });
    store.set(setConsoleEntriesForAppAtom, { appId: 1, entries: [] });

    expect(store.get(consoleEntriesByAppIdAtom).has(1)).toBe(false);
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
      warning: {
        kind: "release-age",
        message: "Install pnpm 10.16.0 or newer",
      },
    });
    store.set(appendConsoleEntriesForAppAtom, {
      appId: 1,
      entries: [consoleEntry("deleted app log", 100)],
    });
    store.set(appendConsoleEntriesForAppAtom, {
      appId: 2,
      entries: [consoleEntry("other app log", 100, 2)],
    });

    expect(store.get(currentPreviewLoadingAtom)).toBe(true);
    expect(store.get(currentAppUrlAtom).appUrl).toBe("http://localhost:3000");
    expect(store.get(currentPackageManagerWarningAtom)).toEqual({
      kind: "release-age",
      message: "Install pnpm 10.16.0 or newer",
      appId: 1,
    });

    store.set(clearPreviewRuntimeForAppAtom, 1);

    expect(store.get(previewRunStateByAppIdAtom).has(1)).toBe(false);
    expect(store.get(currentPreviewLoadingAtom)).toBe(false);
    expect(store.get(currentAppUrlAtom).appUrl).toBeNull();
    expect(store.get(currentPackageManagerWarningAtom)).toBeUndefined();
    expect(store.get(previewCurrentUrlAtom).has(1)).toBe(false);
    expect(store.get(consoleEntriesByAppIdAtom).has(1)).toBe(false);
    expect(store.get(consoleEntriesByAppIdAtom).has(2)).toBe(true);
  });

  it("scopes the package manager warning display to the selected app", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(setPackageManagerWarningForAppAtom, {
      appId: 2,
      warning: {
        kind: "release-age",
        message: "Install pnpm 10.16.0 or newer",
      },
    });

    expect(store.get(currentPackageManagerWarningAtom)).toBeUndefined();

    store.set(selectedAppIdAtom, 2);

    expect(store.get(currentPackageManagerWarningAtom)).toEqual({
      kind: "release-age",
      message: "Install pnpm 10.16.0 or newer",
      appId: 2,
    });
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

  it("dismisses package manager warnings for one app for the session", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);
    store.set(setPackageManagerWarningForAppAtom, {
      appId: 1,
      warning: {
        kind: "release-age",
        message: "Install pnpm 10.16.0 or newer",
      },
    });

    store.set(dismissPackageManagerWarningsAtom, 1);
    store.set(setPackageManagerWarningForAppAtom, {
      appId: 2,
      warning: {
        kind: "release-age",
        message: "Install pnpm 10.16.0 or newer",
      },
    });

    expect(store.get(currentPackageManagerWarningAtom)).toBeUndefined();

    store.set(selectedAppIdAtom, 2);

    expect(store.get(currentPackageManagerWarningAtom)).toEqual({
      kind: "release-age",
      message: "Install pnpm 10.16.0 or newer",
      appId: 2,
    });
  });

  it("keeps release-age warnings ahead of pnpm migration warnings", () => {
    const store = createStore();
    store.set(selectedAppIdAtom, 1);

    store.set(setPackageManagerWarningForAppAtom, {
      appId: 1,
      warning: {
        kind: "pnpm-migration",
        message: "Migrate to pnpm 11",
      },
    });
    store.set(setPackageManagerWarningForAppAtom, {
      appId: 1,
      warning: {
        kind: "release-age",
        message: "Install pnpm 10.16.0 or newer",
      },
    });
    store.set(setPackageManagerWarningForAppAtom, {
      appId: 1,
      warning: {
        kind: "pnpm-migration",
        message: "Migrate to pnpm 11",
      },
    });

    expect(store.get(currentPackageManagerWarningAtom)).toEqual({
      kind: "release-age",
      message: "Install pnpm 10.16.0 or newer",
      appId: 1,
    });
  });
});
