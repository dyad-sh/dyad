import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  createFakeClock,
  createSequentialIdSource,
} from "@/state_machines/testing";
import { ImageGenerationManager } from "@/image_generation/manager";
import { ImageGenerationProvider } from "@/image_generation/ImageGenerationProvider";
import { ImageGenerationProgressDialog } from "./ImageGenerationProgressDialog";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/hooks/useGenerateImage", () => ({
  useGenerateImage: () => ({ cancel: vi.fn() }),
}));

describe("ImageGenerationProgressDialog", () => {
  it("acknowledges a cancellation request and removes the cancel action", () => {
    const manager = new ImageGenerationManager({
      clock: createFakeClock(Date.now()),
      idSource: createSequentialIdSource(),
      runner: { run: vi.fn() },
    });
    const jobId = manager.submit({
      prompt: "A lighthouse",
      themeMode: "plain",
      targetAppId: 1,
      targetAppName: "App",
      source: "chat",
    });
    manager.cancel(jobId);

    render(
      <ImageGenerationProvider manager={manager}>
        <ImageGenerationProgressDialog open onOpenChange={vi.fn()} />
      </ImageGenerationProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /a lighthouse/i }));

    expect(screen.getByText("Cancelling")).toBeTruthy();
    expect(screen.getByText("Cancelling...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
