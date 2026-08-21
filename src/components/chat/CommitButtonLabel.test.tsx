import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CommitButtonLabel,
  CommitStatusAnnouncement,
} from "./CommitButtonLabel";

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
    render(
      <>
        <CommitStatusAnnouncement isCommitting phase="pre-commit" />
        <CommitButtonLabel isCommitting phase="pre-commit" />
      </>,
    );

    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByRole("status").textContent).toBe(
      "Running pre-commit checks...",
    );
  });

  it("announces commit-message validation", () => {
    render(<CommitStatusAnnouncement isCommitting phase="commit-msg" />);

    expect(screen.getByRole("status").textContent).toBe(
      "Validating commit message...",
    );
  });

  it("keeps the live region mounted while idle", () => {
    const { rerender } = render(
      <CommitStatusAnnouncement isCommitting={false} phase={null} />,
    );
    const status = screen.getByRole("status");
    expect(status.textContent).toBe("");

    rerender(<CommitStatusAnnouncement isCommitting phase="staging" />);

    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("Preparing changes...");
  });

  it("returns to the normal label when idle", () => {
    render(<CommitButtonLabel isCommitting={false} phase={null} />);

    expect(screen.getByText("Commit")).toBeTruthy();
  });
});
