import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Version } from "@/ipc/types";
import { ExtraCommitsRevertDialog } from "./ExtraCommitsRevertDialog";

const version: Version = {
  oid: "a".repeat(40),
  message: "Newer commit",
  timestamp: 1_700_000_000,
  dbTimestamp: null,
  isFavorite: false,
  note: null,
};

describe("ExtraCommitsRevertDialog", () => {
  it("disables machine-backed actions while restore capability is unavailable", () => {
    const onConfirm = vi.fn();
    const onRetryFromCurrentCode = vi.fn();

    render(
      <ExtraCommitsRevertDialog
        open
        onOpenChange={vi.fn()}
        kind="retry"
        extraCommits={[version]}
        onConfirm={onConfirm}
        onRetryFromCurrentCode={onRetryFromCurrentCode}
        actionsDisabled
      />,
    );

    const retryButton = screen.getByTestId("retry-from-current-code-button");
    const restoreButton = screen.getByTestId("confirm-revert-anyway-button");
    expect((retryButton as HTMLButtonElement).disabled).toBe(true);
    expect((restoreButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(retryButton);
    fireEvent.click(restoreButton);
    expect(onRetryFromCurrentCode).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(
      (screen.getByTestId("cancel-revert-button") as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
