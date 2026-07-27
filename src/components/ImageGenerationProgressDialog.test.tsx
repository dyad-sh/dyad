import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
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
vi.mock("@/image_generation/hooks", () => ({
  useImageGenerationJobs: () => [
    {
      id: "job-1",
      prompt: "A lighthouse",
      themeMode: "plain",
      targetAppId: 1,
      targetAppName: "App",
      source: "chat",
      startedAt: Date.now(),
      status: "cancelling",
      activeInvocationRef: {
        kind: "image-generation",
        entityKey: "job-1",
        operationId: "operation-1",
      },
    },
  ],
}));

describe("ImageGenerationProgressDialog", () => {
  it("acknowledges a cancellation request and removes the cancel action", () => {
    render(<ImageGenerationProgressDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /a lighthouse/i }));

    expect(screen.getByText("Cancelling")).toBeTruthy();
    expect(screen.getByText("Cancelling...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
