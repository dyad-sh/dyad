import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
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

/** One Jotai store per test, shared by every render in that test. */
function makeWrapper() {
  const store = createStore();
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("SuggestedPromptsStrip", () => {
  it("renders one chip per prompt and sends the clicked one", () => {
    const onSelect = vi.fn();
    render(
      <SuggestedPromptsStrip
        chatId={7}
        messageId={1}
        prompts={[
          "Add a dark mode toggle",
          "Make the homepage text friendlier",
        ]}
        onSelect={onSelect}
      />,
      { wrapper: makeWrapper() },
    );

    expect(screen.getByText("Suggested next steps")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Add a dark mode toggle" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Make the homepage text friendlier" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Make the homepage text friendlier" }),
    );
    expect(onSelect).toHaveBeenCalledWith("Make the homepage text friendlier");
  });

  it("hides after dismissal until a newer message brings new prompts", () => {
    const wrapper = makeWrapper();
    const { rerender } = render(
      <SuggestedPromptsStrip
        chatId={7}
        messageId={1}
        prompts={["Add a dark mode toggle"]}
        onSelect={vi.fn()}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Hide suggestions" }));
    expect(screen.queryByTestId("suggested-prompts")).toBeNull();

    rerender(
      <SuggestedPromptsStrip
        chatId={7}
        messageId={1}
        prompts={["Add a dark mode toggle"]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("suggested-prompts")).toBeNull();

    rerender(
      <SuggestedPromptsStrip
        chatId={7}
        messageId={2}
        prompts={["Connect a database"]}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Connect a database" }),
    ).toBeTruthy();
  });

  it("keeps dismissals separate per chat", () => {
    const wrapper = makeWrapper();
    const first = render(
      <SuggestedPromptsStrip
        chatId={7}
        messageId={1}
        prompts={["Add a dark mode toggle"]}
        onSelect={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide suggestions" }));
    first.unmount();

    render(
      <SuggestedPromptsStrip
        chatId={8}
        messageId={5}
        prompts={["Connect a database"]}
        onSelect={vi.fn()}
      />,
      { wrapper },
    );
    expect(
      screen.getByRole("button", { name: "Connect a database" }),
    ).toBeTruthy();
  });

  it("stays hidden for a dismissed message after unmount and remount", () => {
    const wrapper = makeWrapper();
    const first = render(
      <SuggestedPromptsStrip
        chatId={7}
        messageId={1}
        prompts={["Add a dark mode toggle"]}
        onSelect={vi.fn()}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Hide suggestions" }));
    first.unmount();

    render(
      <SuggestedPromptsStrip
        chatId={7}
        messageId={1}
        prompts={["Add a dark mode toggle"]}
        onSelect={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.queryByTestId("suggested-prompts")).toBeNull();
  });
});
