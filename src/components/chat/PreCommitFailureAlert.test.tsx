import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PreCommitFailureAlert } from "./PreCommitFailureAlert";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "preview.preCommitFailed": "Pre-commit checks failed",
        "preview.preCommitFailedDescription":
          "Your changes were not committed.",
        "preview.viewPreCommitOutput": "View check output",
        "preview.fixWithAi": "Fix with AI",
        "preview.startingAiFix": "Opening chat...",
      })[key] ?? key,
  }),
}));

describe("PreCommitFailureAlert", () => {
  it("shows the hook output and starts the AI fix", () => {
    const onFix = vi.fn();
    render(
      <PreCommitFailureAlert
        error={new Error("lint failed in src/App.tsx")}
        isStartingFix={false}
        onFix={onFix}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Pre-commit checks failed",
    );
    expect(screen.getByText("lint failed in src/App.tsx")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Fix with AI" }));
    expect(onFix).toHaveBeenCalledOnce();
  });

  it("disables the action while chat is opening", () => {
    render(
      <PreCommitFailureAlert
        error={new Error("lint failed")}
        isStartingFix
        onFix={vi.fn()}
      />,
    );

    expect(
      (
        screen.getByRole("button", {
          name: "Opening chat...",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
});
