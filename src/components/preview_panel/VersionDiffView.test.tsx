import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VersionChangedFile, VersionFileChange } from "@/ipc/types";
import { VersionDiffView } from "./VersionDiffView";

const { metadataState, useVersionFileChangeMock } = vi.hoisted(() => ({
  metadataState: {
    changes: [
      { path: "src/a.ts", type: "modified" },
      { path: "src/b.ts", type: "added" },
    ] as VersionChangedFile[],
    truncated: false,
  },
  useVersionFileChangeMock: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "preview.loadingChanges": "Loading changes...",
        "preview.errorLoadingChanges":
          "Couldn't load changes for this version.",
        "preview.noChangesInVersion": "No file changes in this version",
        "preview.tooManyVersionChanges":
          "This commit changes too many files to show them all.",
        "preview.fileTooLarge": "This file is too large to display.",
        "preview.binaryNotSupported": "Binary files can't be displayed.",
      })[key] ?? key,
  }),
}));

vi.mock("@/hooks/useVersionChanges", () => ({
  useVersionChanges: () => ({
    changes: metadataState.changes,
    truncated: metadataState.truncated,
    loading: false,
    error: null,
  }),
  useVersionFileChange: useVersionFileChangeMock,
}));

vi.mock("./FileDiffEditor", () => ({
  FileDiffEditor: ({
    filePath,
    oldContent,
    newContent,
  }: {
    filePath: string;
    oldContent: string;
    newContent: string;
  }) => (
    <div data-testid="mock-diff-editor">
      {filePath}:{oldContent}:{newContent}
    </div>
  ),
}));

function makeFileChange(file: VersionChangedFile): VersionFileChange {
  return {
    ...file,
    oldContent: file.type === "added" ? "" : `old:${file.path}`,
    newContent: file.type === "deleted" ? "" : `new:${file.path}`,
    oldContentStatus: file.type === "added" ? "missing" : "available",
    newContentStatus: file.type === "deleted" ? "missing" : "available",
  };
}

describe("VersionDiffView", () => {
  beforeEach(() => {
    metadataState.truncated = false;
    useVersionFileChangeMock.mockReset();
    useVersionFileChangeMock.mockImplementation(
      (
        _appId: number,
        _versionId: string,
        file: VersionChangedFile | null,
      ) => ({
        change: file ? makeFileChange(file) : null,
        loading: false,
        error: null,
      }),
    );
  });

  it("loads content only for the selected changed file", () => {
    render(<VersionDiffView appId={1} versionId={"a".repeat(40)} />);

    expect(screen.getByTestId("mock-diff-editor").textContent).toContain(
      "src/a.ts:old:src/a.ts:new:src/a.ts",
    );
    expect(useVersionFileChangeMock).toHaveBeenLastCalledWith(
      1,
      "a".repeat(40),
      metadataState.changes[0],
    );

    fireEvent.click(screen.getByText("src/b.ts"));

    expect(screen.getByTestId("mock-diff-editor").textContent).toContain(
      "src/b.ts::new:src/b.ts",
    );
    expect(useVersionFileChangeMock).toHaveBeenLastCalledWith(
      1,
      "a".repeat(40),
      metadataState.changes[1],
    );
  });

  it("discloses when the changed-file metadata list is truncated", () => {
    metadataState.truncated = true;

    render(<VersionDiffView appId={1} versionId={"b".repeat(40)} />);

    expect(
      screen.getByText("This commit changes too many files to show them all."),
    ).not.toBeNull();
  });

  it.each([
    ["too-large", "This file is too large to display."],
    ["binary", "Binary files can't be displayed."],
  ] as const)(
    "shows a friendly message instead of a diff for %s content",
    (status, message) => {
      useVersionFileChangeMock.mockReturnValue({
        change: {
          ...makeFileChange(metadataState.changes[0]),
          newContentStatus: status,
        },
        loading: false,
        error: null,
      });

      render(<VersionDiffView appId={1} versionId={"c".repeat(40)} />);

      expect(screen.getByText(message)).not.toBeNull();
      expect(screen.queryByTestId("mock-diff-editor")).toBeNull();
    },
  );
});
