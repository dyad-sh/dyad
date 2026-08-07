import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { PropsWithChildren } from "react";
import { describe, expect, it } from "vitest";

import { useTrackUnsavedFile, useUnsavedFiles } from "./useUnsavedFiles";

/**
 * One store shared by every renderHook in a test, so an editor that unmounts
 * and a tree that keeps reading observe the same map. See rules/jotai-testing.md.
 */
function makeWrapper() {
  const store = createStore();
  return function Wrapper({ children }: PropsWithChildren) {
    return <Provider store={store}>{children}</Provider>;
  };
}

/** Stands in for a mounted FileEditor publishing its dirty flag. */
function renderEditor(
  wrapper: ReturnType<typeof makeWrapper>,
  initial: { appId: number | null; filePath: string; isUnsaved: boolean },
) {
  return renderHook((props: typeof initial) => useTrackUnsavedFile(props), {
    wrapper,
    initialProps: initial,
  });
}

describe("useUnsavedFiles", () => {
  it("reports a path only while its editor is dirty", () => {
    const wrapper = makeWrapper();
    const tree = renderHook(() => useUnsavedFiles(1), { wrapper });
    const editor = renderEditor(wrapper, {
      appId: 1,
      filePath: "src/App.tsx",
      isUnsaved: false,
    });

    expect([...tree.result.current]).toEqual([]);

    editor.rerender({ appId: 1, filePath: "src/App.tsx", isUnsaved: true });
    expect([...tree.result.current]).toEqual(["src/App.tsx"]);

    // Saving clears the flag without unmounting the editor.
    editor.rerender({ appId: 1, filePath: "src/App.tsx", isUnsaved: false });
    expect([...tree.result.current]).toEqual([]);
  });

  it("clears the entry when the editor unmounts while still dirty", () => {
    const wrapper = makeWrapper();
    const tree = renderHook(() => useUnsavedFiles(1), { wrapper });
    const editor = renderEditor(wrapper, {
      appId: 1,
      filePath: "src/App.tsx",
      isUnsaved: true,
    });

    expect([...tree.result.current]).toEqual(["src/App.tsx"]);

    editor.unmount();
    expect([...tree.result.current]).toEqual([]);
  });

  it("keeps a sibling editor's flag when one of two editors on the same file closes", () => {
    const wrapper = makeWrapper();
    const tree = renderHook(() => useUnsavedFiles(1), { wrapper });
    // The code view and a chat write card can both edit one path; entries are
    // keyed per editor instance so closing one must not clear the other.
    const codeView = renderEditor(wrapper, {
      appId: 1,
      filePath: "src/App.tsx",
      isUnsaved: true,
    });
    const writeCard = renderEditor(wrapper, {
      appId: 1,
      filePath: "src/App.tsx",
      isUnsaved: true,
    });

    expect([...tree.result.current]).toEqual(["src/App.tsx"]);

    codeView.unmount();
    expect([...tree.result.current]).toEqual(["src/App.tsx"]);

    writeCard.unmount();
    expect([...tree.result.current]).toEqual([]);
  });

  it("moves the entry when an editor switches files in place", () => {
    const wrapper = makeWrapper();
    const tree = renderHook(() => useUnsavedFiles(1), { wrapper });
    const editor = renderEditor(wrapper, {
      appId: 1,
      filePath: "src/App.tsx",
      isUnsaved: true,
    });

    expect([...tree.result.current]).toEqual(["src/App.tsx"]);

    editor.rerender({ appId: 1, filePath: "src/Other.tsx", isUnsaved: true });
    expect([...tree.result.current]).toEqual(["src/Other.tsx"]);
  });

  it("scopes paths to the requested app", () => {
    const wrapper = makeWrapper();
    const appOne = renderHook(() => useUnsavedFiles(1), { wrapper });
    const appTwo = renderHook(() => useUnsavedFiles(2), { wrapper });
    renderEditor(wrapper, {
      appId: 2,
      filePath: "src/Other.tsx",
      isUnsaved: true,
    });

    expect([...appOne.result.current]).toEqual([]);
    expect([...appTwo.result.current]).toEqual(["src/Other.tsx"]);
  });

  it("returns the same empty set instance so consumers can memoize on it", () => {
    const wrapper = makeWrapper();
    const withoutApp = renderHook(() => useUnsavedFiles(null), { wrapper });
    const withApp = renderHook(() => useUnsavedFiles(1), { wrapper });

    expect(withoutApp.result.current).toBe(withApp.result.current);
    expect(withApp.result.current.size).toBe(0);
  });

  it("ignores an editor with no app, so a detached buffer marks nothing", () => {
    const wrapper = makeWrapper();
    const tree = renderHook(() => useUnsavedFiles(1), { wrapper });
    renderEditor(wrapper, {
      appId: null,
      filePath: "src/App.tsx",
      isUnsaved: true,
    });

    expect([...tree.result.current]).toEqual([]);
  });
});
