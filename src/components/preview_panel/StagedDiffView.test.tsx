import { render, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  diffContentEditableAtom,
  diffEditModeAtom,
  stagedDiffFileAtom,
} from "@/atoms/viewAtoms";
import type { UncommittedFile } from "@/hooks/useUncommittedFiles";
import type { UncommittedFileDiff } from "@/ipc/types";
import { StagedDiffView } from "./StagedDiffView";

const {
  useUncommittedFilesMock,
  useUncommittedFileDiffMock,
  fileDiffEditorMock,
} = vi.hoisted(() => ({
  useUncommittedFilesMock: vi.fn(),
  useUncommittedFileDiffMock: vi.fn(),
  fileDiffEditorMock: vi.fn(),
}));

vi.mock("@/hooks/useUncommittedFiles", () => ({
  useUncommittedFiles: useUncommittedFilesMock,
}));

vi.mock("@/hooks/useUncommittedFileDiff", () => ({
  useUncommittedFileDiff: useUncommittedFileDiffMock,
}));

// FileDiffEditor pulls in Monaco; stub it so we can inspect the props the diff
// view hands it (notably `editable`) without a real editor.
vi.mock("./FileDiffEditor", () => ({
  FileDiffEditor: (props: { editable: boolean; filePath: string }) => {
    fileDiffEditorMock(props);
    return <div data-testid="mock-file-diff-editor" />;
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makeFile(overrides: Partial<UncommittedFile>): UncommittedFile {
  return {
    path: "src/foo.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    ...overrides,
  };
}

function lastEditorProps() {
  return fileDiffEditorMock.mock.calls.at(-1)?.[0] as
    | { editable: boolean; filePath: string }
    | undefined;
}

describe("StagedDiffView", () => {
  beforeEach(() => {
    useUncommittedFilesMock.mockReset();
    useUncommittedFileDiffMock.mockReset();
    fileDiffEditorMock.mockReset();
  });

  it("keeps a staged deletion read-only so its empty pane can't re-create the file", async () => {
    const deleted = makeFile({
      path: "src/gone.ts",
      status: "deleted",
      additions: 0,
      deletions: 3,
    });
    useUncommittedFilesMock.mockReturnValue({
      uncommittedFiles: [deleted],
      isLoading: false,
    });
    // A deletion has real HEAD content on the left and an empty working-tree
    // side on the right. Empty string is NOT a placeholder, so without the
    // deleted-file guard this would read as editable.
    useUncommittedFileDiffMock.mockReturnValue({
      diff: {
        path: deleted.path,
        oldContent: "export const gone = 1;\n",
        newContent: "",
      } satisfies UncommittedFileDiff,
      loading: false,
      error: null,
    });

    const store = createStore();
    store.set(stagedDiffFileAtom, deleted.path);
    // Force edit mode on to prove a deleted file is never handed edit rights,
    // even if edit mode were somehow already enabled.
    store.set(diffEditModeAtom, true);

    render(
      <Provider store={store}>
        <StagedDiffView appId={1} />
      </Provider>,
    );

    // The shared editable flag is driven to false, which hides the edit toolbar
    // (CodeView gates the pencil on diffContentEditable).
    await waitFor(() => {
      expect(store.get(diffContentEditableAtom)).toBe(false);
    });
    expect(lastEditorProps()?.editable).toBe(false);
  });

  it("allows editing a staged modification", async () => {
    const modified = makeFile({ path: "src/edit.ts", status: "modified" });
    useUncommittedFilesMock.mockReturnValue({
      uncommittedFiles: [modified],
      isLoading: false,
    });
    useUncommittedFileDiffMock.mockReturnValue({
      diff: {
        path: modified.path,
        oldContent: "a\n",
        newContent: "b\n",
      } satisfies UncommittedFileDiff,
      loading: false,
      error: null,
    });

    const store = createStore();
    store.set(stagedDiffFileAtom, modified.path);

    render(
      <Provider store={store}>
        <StagedDiffView appId={1} />
      </Provider>,
    );

    // A real text modification stays editable.
    await waitFor(() => {
      expect(store.get(diffContentEditableAtom)).toBe(true);
    });
  });
});
