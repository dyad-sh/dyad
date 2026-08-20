import { render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FileDiffEditor } from "./FileDiffEditor";

// Records dispose calls so the test can assert both *that* the models are
// disposed and *when* they are disposed relative to the diff widget.
const mocks = vi.hoisted(() => {
  const disposeOrder: string[] = [];

  function createModel(name: string) {
    let disposed = false;
    return {
      isDisposed: () => disposed,
      dispose: () => {
        disposed = true;
        disposeOrder.push(name);
      },
    };
  }

  function createEditor() {
    const models = {
      original: createModel("original-model"),
      modified: createModel("modified-model"),
    };
    return {
      getModel: () => models,
      dispose: () => disposeOrder.push("widget"),
    };
  }

  return { disposeOrder, createEditor };
});

vi.mock("@monaco-editor/react", () => ({
  loader: { init: vi.fn(() => Promise.resolve({})) },
  // Faithfully mirrors @monaco-editor/react@4.7.0's DiffEditor teardown: its
  // `disposeEditor` disposes the models first and the widget last, unless it is
  // told to keep them. Disposing an attached model is what makes Monaco raise
  // "TextModel got disposed before DiffEditorWidget model got reset".
  DiffEditor: (props: {
    onMount?: (editor: ReturnType<typeof mocks.createEditor>) => void;
    keepCurrentOriginalModel?: boolean;
    keepCurrentModifiedModel?: boolean;
  }) => {
    // The library creates and tears the editor down once (`useMount`), so the
    // props are read through a ref rather than re-running the effect.
    const propsRef = useRef(props);
    propsRef.current = props;

    useEffect(() => {
      const editor = mocks.createEditor();
      propsRef.current.onMount?.(editor);
      return () => {
        const { keepCurrentOriginalModel, keepCurrentModifiedModel } =
          propsRef.current;
        const models = editor.getModel();
        if (!keepCurrentOriginalModel) {
          models.original.dispose();
        }
        if (!keepCurrentModifiedModel) {
          models.modified.dispose();
        }
        editor.dispose();
      };
    }, []);
    return <div data-testid="mock-diff-editor" />;
  },
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "light", isDarkMode: false }),
}));

describe("FileDiffEditor model disposal", () => {
  beforeEach(() => {
    mocks.disposeOrder.length = 0;
  });

  it("disposes the diff models after the widget, not before", async () => {
    const view = render(
      <FileDiffEditor
        filePath="src/index.ts"
        oldContent="const a = 1;"
        newContent="const a = 2;"
      />,
    );

    view.unmount();

    // Nothing but the widget is torn down inside the unmount commit itself.
    expect(mocks.disposeOrder).toEqual(["widget"]);

    // The models are released right afterwards, so no model leaks.
    await Promise.resolve();
    expect(mocks.disposeOrder).toEqual([
      "widget",
      "original-model",
      "modified-model",
    ]);
  });
});
