import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreviewErrorBanner } from "./PreviewErrorBanner";

vi.mock("@/hooks/useStreamChat", () => ({
  useStreamChat: () => ({ isStreaming: false }),
}));

vi.mock("@/components/CopyErrorMessage", () => ({
  CopyErrorMessage: () => <button type="button">Copy</button>,
}));

const previewError = {
  message: "Error Line 6 error\nStack trace: Index.tsx:6:6",
  source: "preview-app" as const,
};

describe("PreviewErrorBanner", () => {
  it("collapses to a compact summary and can be expanded again", () => {
    render(
      <PreviewErrorBanner
        error={previewError}
        onDismiss={vi.fn()}
        onAIFix={vi.fn()}
      />,
    );

    expect(screen.getByText(/Tip:/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Fix error with AI" }),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse error banner" }),
    );

    expect(screen.getByTestId("preview-error-banner")).toBeTruthy();
    expect(screen.getByText("Error Line 6 error")).toBeTruthy();
    expect(screen.queryByText(/Tip:/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Fix error with AI" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Expand error banner" }),
    );

    expect(screen.getByText(/Tip:/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Fix error with AI" }),
    ).toBeTruthy();
  });

  it("keeps dismissal separate from collapsing", () => {
    const onDismiss = vi.fn();
    render(
      <PreviewErrorBanner
        error={previewError}
        onDismiss={onDismiss}
        onAIFix={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss error banner" }),
    );

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("still reveals the full error message independently", () => {
    render(
      <PreviewErrorBanner
        error={previewError}
        onDismiss={vi.fn()}
        onAIFix={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Stack trace/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /Show full error message/ }),
    );

    expect(screen.getByText(/Stack trace/)).toBeTruthy();
  });
});
