import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SuggestedPromptsStrip } from "./SuggestedPromptsStrip";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "suggestedPrompts.label": "Suggested next steps",
        "suggestedPrompts.dismiss": "Hide suggestions",
      })[key] ?? key,
  }),
}));

describe("SuggestedPromptsStrip", () => {
  it("renders one chip per prompt and sends the clicked one", () => {
    const onSelect = vi.fn();
    render(
      <SuggestedPromptsStrip
        messageId={1}
        prompts={["Add a dark mode toggle", "Make the header responsive"]}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByText("Suggested next steps")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Make the header responsive" }),
    );
    expect(onSelect).toHaveBeenCalledWith("Make the header responsive");
  });

  it("hides after dismissal until a newer message brings new prompts", () => {
    const { rerender } = render(
      <SuggestedPromptsStrip
        messageId={1}
        prompts={["Add a dark mode toggle"]}
        onSelect={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide suggestions" }));
    expect(screen.queryByTestId("suggested-prompts")).toBeNull();

    rerender(
      <SuggestedPromptsStrip
        messageId={1}
        prompts={["Add a dark mode toggle"]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("suggested-prompts")).toBeNull();

    rerender(
      <SuggestedPromptsStrip
        messageId={2}
        prompts={["Connect a database"]}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Connect a database" }),
    ).toBeTruthy();
  });
});
