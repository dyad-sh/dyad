import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BugScreenshotDialog } from "./BugScreenshotDialog";

const mocks = vi.hoisted(() => {
  const posthogCapture = vi.fn();
  return {
    takeScreenshot: vi.fn(),
    showError: vi.fn(),
    posthogCapture,
    // Stable across renders, matching the real client, so effects keyed on it
    // do not re-run.
    posthogClient: { capture: posthogCapture },
  };
});

vi.mock("@/ipc/types", () => ({
  ipc: { system: { takeScreenshot: mocks.takeScreenshot } },
}));

vi.mock("@/lib/toast", () => ({ showError: mocks.showError }));

vi.mock("posthog-js/react", () => ({
  usePostHog: () => mocks.posthogClient,
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
    onCaptureAbandon: vi.fn(),
    onContinue: vi.fn(),
    source: "report-bug" as const,
    report: { kind: "bug" } as const,
    ...overrides,
  };
  const view = render(<BugScreenshotDialog {...props} />);
  return { ...props, view, props };
}

const SESSION = {
  source: "upload-session",
  report: { kind: "session", sessionId: "v2:abc" },
} as const;

function shownEvents() {
  return mocks.posthogCapture.mock.calls.filter(
    (call) => call[0] === "screenshot-prompt:shown",
  );
}

describe("BugScreenshotDialog", () => {
  beforeEach(() => {
    mocks.takeScreenshot.mockReset().mockResolvedValue(undefined);
    mocks.posthogCapture.mockReset();
    mocks.showError.mockReset();
  });

  it("reports that the prompt was shown, with its source", () => {
    renderPrompt(SESSION);
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:shown",
      { source: "upload-session" },
    );
  });

  it("does not report a prompt that was never opened", () => {
    renderPrompt({ isOpen: false });
    expect(mocks.posthogCapture).not.toHaveBeenCalled();
  });

  it("reports the prompt as shown once per opening", async () => {
    const { view, props } = renderPrompt();
    // Re-render while open, which is what capturing a screenshot does.
    fireEvent.click(screen.getByRole("button", { name: /recommended/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());
    expect(shownEvents()).toHaveLength(1);

    // Closing and reopening is a second offer, so it counts again.
    view.rerender(<BugScreenshotDialog {...props} isOpen={false} />);
    view.rerender(<BugScreenshotDialog {...props} isOpen={true} />);
    expect(shownEvents()).toHaveLength(2);
  });

  it("reports a dismissal as backing out, not as a decline", () => {
    const props = renderPrompt(SESSION);
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));

    expect(props.onDismiss).toHaveBeenCalled();
    expect(props.onContinue).not.toHaveBeenCalled();
  });

  it("answers once even if clicked again while closing", () => {
    const props = renderPrompt();
    const decline = screen.getByText(/without screenshot/);
    // A dialog stays clickable through its closing animation.
    fireEvent.click(decline);
    fireEvent.click(decline);

    expect(props.onContinue).toHaveBeenCalledTimes(1);
    expect(
      mocks.posthogCapture.mock.calls.filter(
        (call) => call[0] === "screenshot-prompt:decline",
      ),
    ).toHaveLength(1);
  });

  it("does not report a dismissal after the prompt was already answered", () => {
    const props = renderPrompt();
    fireEvent.click(screen.getByText(/without screenshot/));
    fireEvent.click(screen.getByText("mock-dialog-dismiss"));

    expect(props.onDismiss).not.toHaveBeenCalled();
    expect(mocks.posthogCapture).not.toHaveBeenCalledWith(
      "screenshot-prompt:dismissed",
      expect.anything(),
    );
  });

  it("files the report as declined when the reporter skips the screenshot", () => {
    const props = renderPrompt();
    fireEvent.click(screen.getByText(/without screenshot/));

    expect(props.onContinue).toHaveBeenCalledWith(
      { status: "declined" },
      { kind: "bug" },
    );
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
      "screenshot-prompt:capture-attempt",
      { source: "report-bug" },
    );

    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());
    fireEvent.click(await screen.findByText("Create GitHub issue"));
    expect(props.onContinue).toHaveBeenCalledWith(
      { status: "captured" },
      { kind: "bug" },
    );
  });

  it("reports a captured screenshot that the reporter files", async () => {
    renderPrompt();
    fireEvent.click(screen.getByRole("button", { name: /recommended/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());
    fireEvent.click(await screen.findByText("Create GitHub issue"));

    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:captured",
      { source: "report-bug" },
    );
  });

  it("files a late capture against the report that started it", async () => {
    const props = renderPrompt({
      report: { kind: "session", sessionId: "v2:first" },
    });
    fireEvent.click(screen.getByRole("button", { name: /recommended/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());

    // Another report starts while this capture is still resolving.
    props.view.rerender(
      <BugScreenshotDialog {...props.props} report={{ kind: "bug" }} />,
    );
    fireEvent.click(await screen.findByText("Create GitHub issue"));

    expect(props.onContinue).toHaveBeenCalledWith(
      { status: "captured" },
      {
        kind: "session",
        sessionId: "v2:first",
      },
    );
  });

  it("reports a late capture under the source that started it", async () => {
    const props = renderPrompt({
      source: "upload-session",
      report: { kind: "session", sessionId: "v2:first" },
    });
    fireEvent.click(screen.getByRole("button", { name: /recommended/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());

    // The other flow opens a prompt while this capture is still resolving.
    props.view.rerender(
      <BugScreenshotDialog
        {...props.props}
        source="report-bug"
        report={{ kind: "bug" }}
      />,
    );
    fireEvent.click(await screen.findByText("Create GitHub issue"));

    // Both halves of one capture belong to the same flow.
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:capture-attempt",
      { source: "upload-session" },
    );
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:captured",
      { source: "upload-session" },
    );
  });

  it("reports a captured screenshot that the reporter abandons", async () => {
    const props = renderPrompt(SESSION);
    fireEvent.click(screen.getByRole("button", { name: /recommended/ }));
    await waitFor(() => expect(mocks.takeScreenshot).toHaveBeenCalled());
    await screen.findByText("Create GitHub issue");

    // The success dialog renders after the prompt, so its dismiss is last.
    const dismissals = screen.getAllByText("mock-dialog-dismiss");
    fireEvent.click(dismissals[dismissals.length - 1]);

    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:capture-abandoned",
      { source: "upload-session" },
    );
    expect(props.onContinue).not.toHaveBeenCalled();
  });

  it("still files the report when the capture fails, recording why", async () => {
    mocks.takeScreenshot.mockRejectedValue(
      new Error("No focused window to capture"),
    );
    const props = renderPrompt(SESSION);
    fireEvent.click(screen.getByRole("button", { name: /recommended/ }));

    await waitFor(() =>
      expect(props.onContinue).toHaveBeenCalledWith(
        { status: "capture-failed", reason: "No focused window to capture" },
        SESSION.report,
      ),
    );
    expect(mocks.posthogCapture).toHaveBeenCalledWith(
      "screenshot-prompt:capture-failed",
      { source: "upload-session", failure: "no-focused-window" },
    );
  });

  it("tells the reporter the capture failed", async () => {
    mocks.takeScreenshot.mockRejectedValue(new Error("no window"));
    renderPrompt();
    fireEvent.click(screen.getByRole("button", { name: /recommended/ }));

    // Without this the reporter reaches GitHub expecting an image to paste.
    await waitFor(() =>
      expect(mocks.showError).toHaveBeenCalledWith("no window"),
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
