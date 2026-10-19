import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DyadAttachment } from "./DyadAttachment";

vi.mock("./ImageLightbox", () => ({
  ImageLightbox: () => null,
  openFile: vi.fn(),
}));

function renderAttachment(name: string, type: string) {
  return render(
    <DyadAttachment
      node={{ properties: { name, type, path: `/media/${name}` } }}
    />,
  );
}

describe("DyadAttachment", () => {
  it("offers to open a regular file", () => {
    const { container } = renderAttachment("notes.txt", "text/plain");
    expect(screen.queryByRole("button")).not.toBeNull();
    expect(container.querySelector(".lucide-external-link")).not.toBeNull();
  });

  it("does not offer to open an archive", () => {
    const { container } = renderAttachment("project.zip", "application/zip");
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector(".lucide-external-link")).toBeNull();
  });
});
