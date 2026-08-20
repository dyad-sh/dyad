import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommitButtonLabel } from "./CommitButtonLabel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "preview.commit": "Commit",
        "preview.committing": "Committing...",
        "preview.preparingChanges": "Preparing changes...",
        "preview.runningPreCommitChecks": "Running pre-commit checks...",
        "preview.validatingCommitMessage": "Validating commit message...",
        "preview.creatingCommit": "Creating commit...",
      })[key] ?? key,
  }),
}));

describe("CommitButtonLabel", () => {
  it("shows the main-owned pre-commit phase", () => {
    render(<CommitButtonLabel isCommitting phase="pre-commit" />);

    expect(
      screen
        .getByText("Running pre-commit checks...")
        .getAttribute("aria-live"),
    ).toBe("polite");
  });

  it("announces commit-message validation", () => {
    render(<CommitButtonLabel isCommitting phase="commit-msg" />);

    expect(
      screen
        .getByText("Validating commit message...")
        .getAttribute("aria-live"),
    ).toBe("polite");
  });

  it("returns to the normal label when idle", () => {
    render(<CommitButtonLabel isCommitting={false} phase={null} />);

    expect(screen.getByText("Commit")).toBeTruthy();
  });
});
