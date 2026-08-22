import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommitDialogFooter } from "./CommitDialogActions";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "preview.cancel": "Cancel",
        "preview.cancelCommit": "Cancel commit",
        "preview.stopChecks": "Stop checks",
        "preview.cancellingCommit": "Cancelling...",
        "preview.commit": "Commit",
        "preview.committing": "Committing...",
        "preview.preparingChanges": "Preparing changes...",
        "preview.runningPreCommitChecks": "Running pre-commit checks...",
        "preview.validatingCommitMessage": "Validating commit message...",
        "preview.creatingCommit": "Creating commit...",
      })[key] ?? key,
  }),
}));

const defaultProps = {
  leadingAction: undefined,
  isCommitting: false,
  isCancellingCommit: false,
  phase: null,
  isBusy: false,
  commitDisabled: false,
  commitButtonTestId: "commit-button",
  onDismiss: vi.fn(),
  onCancelCommit: vi.fn(),
  onCommit: vi.fn(),
} as const;

describe("CommitDialogFooter", () => {
  it("makes cancellation explicit while checks are running", () => {
    const onCancelCommit = vi.fn();
    render(
      <CommitDialogFooter
        {...defaultProps}
        isCommitting
        phase="pre-commit"
        onCancelCommit={onCancelCommit}
      />,
    );

    const cancel = screen.getByTestId("cancel-commit-button");
    expect(cancel.textContent).toBe("Stop checks");
    fireEvent.click(cancel);
    expect(onCancelCommit).toHaveBeenCalledOnce();
  });

  it("offers cancellation while queued before progress arrives", () => {
    render(<CommitDialogFooter {...defaultProps} isCommitting phase={null} />);

    expect(screen.getByTestId("cancel-commit-button").textContent).toBe(
      "Cancel commit",
    );
    expect(
      screen.getByTestId("cancel-commit-button").hasAttribute("disabled"),
    ).toBe(false);
  });

  it("shows cancellation feedback and prevents a duplicate request", () => {
    render(
      <CommitDialogFooter
        {...defaultProps}
        isCommitting
        isCancellingCommit
        phase="pre-commit"
      />,
    );

    expect(screen.getByTestId("cancel-commit-button").textContent).toBe(
      "Cancelling...",
    );
    expect(
      screen.getByTestId("cancel-commit-button").hasAttribute("disabled"),
    ).toBe(true);
  });
});
