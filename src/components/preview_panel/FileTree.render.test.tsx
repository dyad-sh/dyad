import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";

import { selectedFileAtom } from "@/atoms/viewAtoms";
import { FileTree } from "./FileTree";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/useSearchAppFiles", () => ({
  useSearchAppFiles: () => ({
    results: [],
    loading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useUncommittedFiles", () => ({
  useUncommittedFiles: () => ({ uncommittedFiles: [] }),
}));

vi.mock("@/hooks/useUnsavedFiles", () => ({
  useUnsavedFiles: () => new Set<string>(),
}));

describe("FileTree", () => {
  it("renders folders collapsed by default", () => {
    render(
      <Provider>
        <FileTree
          appId={1}
          files={["src/components/Button.tsx", "src/App.tsx"]}
        />
      </Provider>,
    );

    const srcDirectory = screen.getByTestId("file-tree-dir");
    expect(srcDirectory.getAttribute("data-path")).toBe("src");
    expect(srcDirectory.getAttribute("aria-expanded")).toBe("false");
    expect(srcDirectory.getAttribute("tabindex")).toBe("0");
    expect(screen.queryByText("components")).toBeNull();
    expect(screen.queryByText("App.tsx")).toBeNull();

    fireEvent.keyDown(srcDirectory, { key: "Enter" });

    expect(srcDirectory.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("components")).not.toBeNull();
    expect(screen.getByText("App.tsx")).not.toBeNull();
    expect(screen.queryByText("Button.tsx")).toBeNull();

    fireEvent.keyDown(srcDirectory, { key: " " });
    expect(srcDirectory.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("App.tsx")).toBeNull();
  });

  it("scopes expansion by app and preserves it across remounts", () => {
    const store = createStore();
    const files = ["src/App.tsx"];
    const view = render(
      <Provider store={store}>
        <FileTree appId={1} files={files} />
      </Provider>,
    );

    fireEvent.click(screen.getByTestId("file-tree-dir"));
    expect(screen.getByText("App.tsx")).not.toBeNull();

    view.rerender(
      <Provider store={store}>
        <FileTree appId={2} files={files} />
      </Provider>,
    );
    expect(screen.queryByText("App.tsx")).toBeNull();

    view.unmount();
    render(
      <Provider store={store}>
        <FileTree appId={1} files={files} />
      </Provider>,
    );
    expect(screen.getByText("App.tsx")).not.toBeNull();
  });

  it("reveals and identifies a file selected outside the tree", async () => {
    const store = createStore();
    store.set(selectedFileAtom, { path: "src/components/Button.tsx" });

    render(
      <Provider store={store}>
        <FileTree appId={1} files={["src/components/Button.tsx"]} />
      </Provider>,
    );

    await waitFor(() => expect(screen.getByText("Button.tsx")).not.toBeNull());
    expect(
      screen.getByTestId("file-tree-file").getAttribute("aria-current"),
    ).toBe("page");
  });
});
