import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { setImageGenerationJobsProjectionAtom } from "@/atoms/imageGenerationAtoms";
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
    const store = createStore();
    store.set(setImageGenerationJobsProjectionAtom, [
      {
        id: "job-1",
        prompt: "A lighthouse",
        themeMode: "plain",
        targetAppId: 1,
        targetAppName: "App",
        status: "cancelling",
        startedAt: Date.now(),
        source: "chat",
      },
    ]);

    render(
      <Provider store={store}>
        <ImageGenerationProgressDialog open onOpenChange={vi.fn()} />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /a lighthouse/i }));

    expect(screen.getByText("Cancelling")).toBeTruthy();
    expect(screen.getByText("Cancelling...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
