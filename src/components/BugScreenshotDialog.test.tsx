import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BugScreenshotDialog } from "./BugScreenshotDialog";

const mocks = vi.hoisted(() => ({
  takeScreenshot: vi.fn(),
  posthogCapture: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: { system: { takeScreenshot: mocks.takeScreenshot } },
}));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => ({ capture: mocks.posthogCapture }),
}));

vi.mock("./ui/dialog", () => ({
  Dialog: ({
    open,
    onOpenChange,
    children,
  }: {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) =>
    open ? (
      <div>
        {/* Stands in for Esc, the overlay, and the built-in close button. */}
        <button onClick={() => onOpenChange?.(false)}>
          mock-dialog-dismiss
        </button>
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

function renderPrompt(
  overrides: Partial<Parameters<typeof BugScreenshotDialog>[0]> = {},
) {
  const props = {
    isOpen: true,
    onClose: vi.fn(),
    onDismiss: vi.fn(),
    onContinue: vi.fn(),
    isLoading: false,
    source: "report-bug" as const,
    ...overrides,
  };
  render(<BugScreenshotDialog {...props} />);
  return props;
}

describe("BugScreenshotDialog", () => {
  beforeEach(() => {
    mocks.takeScreenshot.mockReset().mockResolvedValue(undefined);
    mocks.posthogCapture.mockReset();
  });

  it("reports that the prompt was shown, with its source", () => {
    renderPrompt({ source: "upload-session" });
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:shown",
      { source: "upload-session" },
    );
  });

  it("does not report a prompt that was never opened", () => {
    renderPrompt({ isOpen: false });
    expect(mocks.posthogCapture).not.toHaveBeenCalled();
  });

  it("reports a dismissal as backing out, not as a decline", () => {
    const props = renderPrompt({ source: "upload-session" });
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));

    expect(props.onDismiss).toHaveBeenCalled();
    expect(props.onContinue).not.toHaveBeenCalled();
  });

  it("files the report as declined when the reporter skips the screenshot", () => {
    const props = renderPrompt();
    fireEvent.click(screen.getByText(/without screenshot/));

    expect(props.onContinue).toHaveBeenCalledWith({ status: "declined" });
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:decline",
      { source: "report-bug" },
    );
  });

  it("captures a screenshot and files the report as captured", async () => {
    const props = renderPrompt();
    fireEvent.click(screen.getByRole("button", { name: /recommended/ }));

    expect(props.onClose).toHaveBeenCalled();
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:capture",
      { source: "report-bug" },
    );

    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());
    fireEvent.click(await screen.findByText("Create GitHub issue"));
    expect(props.onContinue).toHaveBeenCalledWith({ status: "captured" });
  });

  it("still files the report when the capture fails, recording why", async () => {
    mocks.takeScreenshot.mockRejectedValue(
      new Error("No focused window to capture"),
    );
    const props = renderPrompt({ source: "upload-session" });
    fireEvent.click(screen.getByRole("button", { name: /recommended/ }));

    await waitFor(() =>
      expect(props.onContinue).toHaveBeenCalledWith({
        status: "capture-failed",
        reason: "No focused window to capture",
      }),
    );
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:capture-failed",
      { source: "upload-session", reason: "No focused window to capture" },
    );
  });

  it("does not show the paste reminder when the capture fails", async () => {
    mocks.takeScreenshot.mockRejectedValue(new Error("nope"));
    renderPrompt();
    fireEvent.click(screen.getByRole("button", { name: /recommended/ }));

    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());
    expect(screen.queryByText("Create GitHub issue")).toBeNull();
  });
});
