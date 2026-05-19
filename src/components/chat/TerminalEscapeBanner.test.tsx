import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalEscapeBanner } from "./TerminalEscapeBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "terminal.bannerMode": "Terminal",
        "terminal.context.exit": "Exit terminal",
        "terminal.toggleAriaLabel": "Toggle terminal",
      })[key] ?? key,
  }),
}));

describe("TerminalEscapeBanner", () => {
  it("renders terminal chrome with a close affordance", () => {
    const onExit = vi.fn();
    render(
      <TerminalEscapeBanner appName="Demo" cwd="/tmp/demo" onExit={onExit} />,
    );

    expect(screen.getByText("Terminal")).toBeTruthy();
    expect(screen.queryByText(/Demo/)).toBeNull();
    expect(screen.getByText("/tmp/demo")).toBeTruthy();
    expect(screen.queryByText(/press/i)).toBeNull();
    expect(screen.queryByText(/K/)).toBeNull();

    expect(screen.getByRole("button", { name: /exit terminal/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /toggle terminal/i }));

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
