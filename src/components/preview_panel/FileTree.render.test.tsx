import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";

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
    expect(screen.queryByText("components")).toBeNull();
    expect(screen.queryByText("App.tsx")).toBeNull();

    fireEvent.click(srcDirectory);

    expect(screen.getByText("components")).not.toBeNull();
    expect(screen.getByText("App.tsx")).not.toBeNull();
    expect(screen.queryByText("Button.tsx")).toBeNull();
  });
});
