import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommitCheckFailureAlert } from "./CommitCheckFailureAlert";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "preview.preCommitFailed": "Pre-commit checks failed",
        "preview.preCommitFailedDescription":
          "Your changes were not committed. Fix the reported issues and commit again.",
        "preview.commitMsgFailed": "Commit message check failed",
        "preview.commitMsgFailedDescription":
          "Your changes were not committed. Update the commit message and commit again.",
        "preview.prepareCommitMsgFailed": "Commit message preparation failed",
        "preview.prepareCommitMsgFailedDescription":
          "Review the hook output and fix its setup or environment.",
        "preview.viewPreCommitOutput": "View check output",
        "preview.fixWithAi": "Fix with AI",
        "preview.fixWithAiDescription":
          "Dyad will try to fix the reported issues.",
        "preview.startingAiFix": "Opening chat...",
      })[key] ?? key,
  }),
}));

describe("CommitCheckFailureAlert", () => {
  it("shows the hook output and starts the AI fix", () => {
    const onFix = vi.fn();
    render(
      <CommitCheckFailureAlert
        kind="pre-commit"
        error={new Error("lint failed in src/App.tsx")}
        isStartingFix={false}
        onFix={onFix}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Pre-commit checks failed",
    );
    expect(screen.getByText("lint failed in src/App.tsx")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Fix with AI/ }));
    expect(onFix).toHaveBeenCalledOnce();
  });

  it("describes the AI fix as an attempt rather than something already done", () => {
    render(
      <CommitCheckFailureAlert
        kind="pre-commit"
        error={new Error("lint failed")}
        isStartingFix={false}
        onFix={vi.fn()}
      />,
    );

    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain(
      "Your changes were not committed. Fix the reported issues and commit again.",
    );
    expect(alert).toContain("Dyad will try to fix the reported issues.");
  });

  it("disables the action while chat is opening", () => {
    render(
      <CommitCheckFailureAlert
        kind="pre-commit"
        error={new Error("lint failed")}
        isStartingFix
        onFix={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: /Opening chat\.\.\./,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("shows commit-msg output inline without offering an AI fix", () => {
    render(
      <CommitCheckFailureAlert
        kind="commit-msg"
        error={new Error("subject may not be empty [subject-empty]")}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-testid")).toBe("commit-msg-failure-alert");
    expect(alert.textContent).toContain("Commit message check failed");
    expect(
      screen.getByText("subject may not be empty [subject-empty]"),
    ).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("does not tell users to edit the message when preparation fails", () => {
    render(
      <CommitCheckFailureAlert
        kind="prepare-commit-msg"
        error={new Error("could not resolve the ticket id")}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert.getAttribute("data-testid")).toBe(
      "prepare-commit-msg-failure-alert",
    );
    expect(alert.textContent).toContain("Commit message preparation failed");
    expect(alert.textContent).toContain("fix its setup or environment");
    expect(alert.textContent).not.toContain("Update the commit message");
  });
});
