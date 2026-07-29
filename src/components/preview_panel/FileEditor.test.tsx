import { useEffect, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { editorCursorAtom } from "@/atoms/viewAtoms";
import { FileEditor } from "./FileEditor";

const mocks = vi.hoisted(() => {
  let cursorListener:
    | ((event: { position: { lineNumber: number; column: number } }) => void)
    | undefined;
  const editor = {
    getModel: vi.fn(() => ({
      isDisposed: () => false,
      dispose: vi.fn(),
      getLineCount: () => 100,
    })),
    getPosition: vi.fn(() => null),
    setPosition: vi.fn(),
    revealPositionInCenter: vi.fn(),
    revealLineInCenter: vi.fn(),
    onDidChangeCursorPosition: vi.fn(
      (
        listener: (event: {
          position: { lineNumber: number; column: number };
        }) => void,
      ) => {
        cursorListener = listener;
        return { dispose: vi.fn() };
      },
    ),
    onDidBlurEditorText: vi.fn(() => ({ dispose: vi.fn() })),
  };
  return {
    editor,
    emitCursor(lineNumber: number, column: number) {
      cursorListener?.({ position: { lineNumber, column } });
    },
  };
});

vi.mock("@monaco-editor/react", () => ({
  default: ({
    onMount,
  }: {
    onMount: (editor: typeof mocks.editor) => void;
  }) => {
    const mounted = useRef(false);
    useEffect(() => {
      if (mounted.current) return;
      mounted.current = true;
      onMount(mocks.editor);
    }, [onMount]);
    return <div data-testid="monaco-editor" />;
  },
}));

vi.mock("@/hooks/useLoadAppFile", () => ({
  useLoadAppFile: () => ({
    content: "const value = 1;",
    loading: false,
    error: null,
  }),
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light" }),
}));

describe("FileEditor cursor persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes cursor movement against the latest file props", async () => {
    const store = createStore();
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <FileEditor appId={1} filePath="src/first.ts" persistCursor />
        </Provider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(mocks.editor.onDidChangeCursorPosition).toHaveBeenCalled(),
    );

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <FileEditor appId={2} filePath="src/second.ts" persistCursor />
        </Provider>
      </QueryClientProvider>,
    );
    mocks.emitCursor(12, 4);

    expect(store.get(editorCursorAtom)).toEqual({
      appId: 2,
      path: "src/second.ts",
      lineNumber: 12,
      column: 4,
    });
  });

  it("does not let an initial line overwrite a matching restored cursor", async () => {
    const store = createStore();
    store.set(editorCursorAtom, {
      appId: 1,
      path: "src/file.ts",
      lineNumber: 22,
      column: 7,
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <Provider store={store}>
          <FileEditor
            appId={1}
            filePath="src/file.ts"
            initialLine={5}
            persistCursor
          />
        </Provider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(mocks.editor.setPosition).toHaveBeenCalledWith({
        lineNumber: 22,
        column: 7,
      }),
    );
    expect(mocks.editor.setPosition).not.toHaveBeenCalledWith({
      lineNumber: 5,
      column: 1,
    });
  });

  it("honors a later line target in the same file", async () => {
    const store = createStore();
    store.set(editorCursorAtom, {
      appId: 1,
      path: "src/file.ts",
      lineNumber: 22,
      column: 7,
    });
    const queryClient = new QueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <FileEditor
            appId={1}
            filePath="src/file.ts"
            initialLine={5}
            persistCursor
          />
        </Provider>
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(mocks.editor.setPosition).toHaveBeenCalledWith({
        lineNumber: 22,
        column: 7,
      }),
    );

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <FileEditor
            appId={1}
            filePath="src/file.ts"
            initialLine={18}
            persistCursor
          />
        </Provider>
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(mocks.editor.setPosition).toHaveBeenCalledWith({
        lineNumber: 18,
        column: 1,
      }),
    );
  });
});
