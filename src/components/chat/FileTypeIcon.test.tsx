import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { FileTypeCard, FileTypeIcon } from "./FileTypeIcon";

describe("FileTypeIcon", () => {
  it("tags the tile with the file kind", () => {
    render(<FileTypeIcon fileName="scan.pdf" />);
    expect(screen.getByTestId("file-type-icon").dataset.fileKind).toBe("pdf");
  });

  it("shows the extension badge", () => {
    render(<FileTypeIcon fileName="budget.xlsx" />);
    expect(screen.getByText("XLSX")).toBeTruthy();
  });

  it("shows a thumbnail instead of an icon when one is available", () => {
    render(<FileTypeIcon fileName="shot.png" previewUrl="blob:preview" />);
    const image = screen.getByTestId("file-type-icon").querySelector("img");
    expect(image?.getAttribute("src")).toBe("blob:preview");
    // The badge would sit on top of the picture.
    expect(screen.queryByText("PNG")).toBeNull();
  });

  it("shows the uploading state only while uploading", () => {
    const { rerender } = render(<FileTypeIcon fileName="a.pdf" uploading />);
    expect(screen.getByTestId("file-type-icon-uploading")).toBeTruthy();

    rerender(<FileTypeIcon fileName="a.pdf" />);
    expect(screen.queryByTestId("file-type-icon-uploading")).toBeNull();
  });
});

describe("FileTypeCard", () => {
  it("shows the name, kind and size", () => {
    render(<FileTypeCard fileName="scan.pdf" sizeBytes={2048} />);
    expect(screen.getByText("scan.pdf")).toBeTruthy();
    expect(screen.getByText("PDF · 2 KB")).toBeTruthy();
  });

  it("says it is uploading rather than showing a size", () => {
    render(<FileTypeCard fileName="scan.pdf" sizeBytes={2048} uploading />);
    expect(screen.getByText("Uploading…")).toBeTruthy();
    expect(screen.queryByText("PDF · 2 KB")).toBeNull();
  });

  it("omits the size when it is unknown", () => {
    render(<FileTypeCard fileName="notes.docx" />);
    expect(screen.getByText("Document")).toBeTruthy();
  });
});
