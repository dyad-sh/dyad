import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { PropsWithChildren } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { diffDirtyAtom, diffSaveRequestAtom } from "@/atoms/viewAtoms";
import { queryKeys } from "@/lib/queryKeys";
import { FileDiffEditor } from "./FileDiffEditor";

const {
  editAppFileMock,
  handleSwitchedToMainBranchMock,
  modifiedEditorMock,
  modifiedModelListeners,
} = vi.hoisted(() => ({
  editAppFileMock: vi.fn(),
  handleSwitchedToMainBranchMock: vi.fn(),
  ...(() => {
    const listeners: Array<() => void> = [];
    const editor = {
      value: "saved from diff",
      getValue: vi.fn(() => editor.value),
      onDidChangeModelContent: vi.fn((listener: () => void) => {
        listeners.push(listener);
      }),
      addCommand: vi.fn(),
    };
    return {
      modifiedEditorMock: editor,
      modifiedModelListeners: listeners,
    };
  })(),
}));

vi.mock("@monaco-editor/react", () => ({
  DiffEditor: ({
    onMount,
  }: {
    onMount: (
      editor: {
        getModifiedEditor: () => typeof modifiedEditorMock;
      },
      monaco: { KeyMod: { CtrlCmd: number }; KeyCode: { KeyS: number } },
    ) => void;
  }) => {
    onMount(
      {
        getModifiedEditor: () => modifiedEditorMock,
      },
      {
        KeyMod: { CtrlCmd: 1 },
        KeyCode: { KeyS: 2 },
      },
    );
    return <div data-testid="mock-diff-editor" />;
  },
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ isDarkMode: false }),
}));

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/types")>()),
  ipc: {
    app: {
      editAppFile: editAppFileMock,
    },
  },
}));

vi.mock("@/hooks/useSwitchedToMainBranch", () => ({
  useSwitchedToMainBranch: () => handleSwitchedToMainBranchMock,
}));

vi.mock("@/lib/toast", () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
}));

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

function makeWrapper(
  queryClient: QueryClient,
  store: ReturnType<typeof createStore>,
) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <Provider store={store}>
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </Provider>
    );
  };
}

describe("FileDiffEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modifiedEditorMock.value = "saved from diff";
    modifiedModelListeners.length = 0;
    handleSwitchedToMainBranchMock.mockResolvedValue(undefined);
  });

  it("does not replace newer in-editor edits with just-saved diff cache data", async () => {
    const appId = 1;
    const filePath = "src/App.tsx";
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    queryClient.setQueryData(
      queryKeys.uncommittedFiles.diff({ appId, filePath }),
      {
        path: filePath,
        oldContent: "base",
        newContent: "before save",
      },
    );
    const store = createStore();
    const saveDeferred = createDeferred<Record<string, never>>();
    editAppFileMock.mockReturnValue(saveDeferred.promise);

    render(
      <FileDiffEditor
        filePath={filePath}
        oldContent="base"
        newContent="before save"
        editable
        appId={appId}
      />,
      { wrapper: makeWrapper(queryClient, store) },
    );

    store.set(diffSaveRequestAtom, 1);

    await waitFor(() => {
      expect(editAppFileMock).toHaveBeenCalledWith({
        appId,
        filePath,
        content: "saved from diff",
        targetBranchName: undefined,
        expectedBranchTipOid: undefined,
      });
    });

    modifiedEditorMock.value = "newer unsaved edit";
    for (const listener of modifiedModelListeners) {
      listener();
    }
    saveDeferred.resolve({});

    await waitFor(() => {
      expect(store.get(diffDirtyAtom)).toBe(true);
    });
    expect(
      queryClient.getQueryData(
        queryKeys.uncommittedFiles.diff({ appId, filePath }),
      ),
    ).toEqual({
      path: filePath,
      oldContent: "base",
      newContent: "before save",
    });
  });
});
