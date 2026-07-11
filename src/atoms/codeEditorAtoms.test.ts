import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import {
  clearCodeEditorStateForAppAtom,
  closeCodeEditorFileAtom,
  openCodeEditorFilesByAppIdAtom,
  reconcileCodeEditorFilesAtom,
  selectCodeEditorFileAtom,
  selectedCodeEditorFileByAppIdAtom,
} from "./codeEditorAtoms";

describe("codeEditorAtoms", () => {
  it("keeps open files and selection isolated by app", () => {
    const store = createStore();

    store.set(selectCodeEditorFileAtom, {
      appId: 1,
      file: { path: "src/one.ts" },
    });
    store.set(selectCodeEditorFileAtom, {
      appId: 2,
      file: { path: "src/two.ts", line: 12 },
    });

    expect(store.get(openCodeEditorFilesByAppIdAtom)).toEqual(
      new Map([
        [1, ["src/one.ts"]],
        [2, ["src/two.ts"]],
      ]),
    );
    expect(store.get(selectedCodeEditorFileByAppIdAtom).get(2)).toEqual({
      path: "src/two.ts",
      line: 12,
    });
  });

  it("does not duplicate a tab when a file is selected again", () => {
    const store = createStore();

    store.set(selectCodeEditorFileAtom, {
      appId: 1,
      file: { path: "src/app.ts", line: 2 },
    });
    store.set(selectCodeEditorFileAtom, {
      appId: 1,
      file: { path: "src/app.ts", line: 9 },
    });

    expect(store.get(openCodeEditorFilesByAppIdAtom).get(1)).toEqual([
      "src/app.ts",
    ]);
    expect(store.get(selectedCodeEditorFileByAppIdAtom).get(1)?.line).toBe(9);
  });

  it("selects the neighboring tab when the active file closes", () => {
    const store = createStore();
    for (const path of ["one.ts", "two.ts", "three.ts"]) {
      store.set(selectCodeEditorFileAtom, { appId: 1, file: { path } });
    }

    store.set(closeCodeEditorFileAtom, { appId: 1, path: "two.ts" });

    expect(store.get(openCodeEditorFilesByAppIdAtom).get(1)).toEqual([
      "one.ts",
      "three.ts",
    ]);
    expect(store.get(selectedCodeEditorFileByAppIdAtom).get(1)).toEqual({
      path: "three.ts",
    });
  });

  it("removes files that no longer exist and clears deleted app state", () => {
    const store = createStore();
    store.set(selectCodeEditorFileAtom, {
      appId: 1,
      file: { path: "removed.ts" },
    });
    store.set(selectCodeEditorFileAtom, {
      appId: 1,
      file: { path: "kept.ts" },
    });
    store.set(selectCodeEditorFileAtom, {
      appId: 1,
      file: { path: "removed.ts" },
    });

    store.set(reconcileCodeEditorFilesAtom, {
      appId: 1,
      files: ["kept.ts"],
    });

    expect(store.get(openCodeEditorFilesByAppIdAtom).get(1)).toEqual([
      "kept.ts",
    ]);
    expect(store.get(selectedCodeEditorFileByAppIdAtom).get(1)).toEqual({
      path: "kept.ts",
    });

    store.set(clearCodeEditorStateForAppAtom, 1);
    expect(store.get(openCodeEditorFilesByAppIdAtom).has(1)).toBe(false);
    expect(store.get(selectedCodeEditorFileByAppIdAtom).has(1)).toBe(false);
  });
});
