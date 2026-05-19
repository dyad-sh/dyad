import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TerminalEscapeBanner } from "./TerminalEscapeBanner";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "terminal.bannerMode": "Terminal mode",
        "terminal.bannerExitPrefix": "Click here or press",
      })[key] ?? key,
  }),
}));

describe("TerminalEscapeBanner", () => {
  it("is a clickable escape affordance with the terminal chord", () => {
    const onExit = vi.fn();
    render(
      <TerminalEscapeBanner appName="Demo" cwd="/tmp/demo" onExit={onExit} />,
    );

    const button = screen.getByRole("button", { name: /terminal mode/i });
    expect(button.textContent).toContain("Demo");
    expect(button.textContent).toContain("/tmp/demo");
    expect(button.textContent).toMatch(/K/);

    fireEvent.click(button);

    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
