import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageLightbox } from "./ImageLightbox";

const openMediaFile = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@/ipc/types", () => ({
  ipc: {
    media: { openMediaFile },
    system: { openFilePath: vi.fn(async () => undefined) },
  },
}));

describe("ImageLightbox", () => {
  beforeEach(() => {
    openMediaFile.mockClear();
  });

  it("opens a projected media result without exposing an absolute path", () => {
    render(
      <ImageLightbox
        imageUrl="dyad-media://generated.png"
        alt="Generated lighthouse"
        mediaFile={{ appId: 7, fileName: "generated.png" }}
        onClose={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open file" }));

    expect(openMediaFile).toHaveBeenCalledWith({
      appId: 7,
      fileName: "generated.png",
    });
  });
});
