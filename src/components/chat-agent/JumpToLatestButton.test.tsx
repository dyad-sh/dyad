import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { JumpToLatestButton } from "./JumpToLatestButton";

describe("JumpToLatestButton", () => {
  it("is hidden from assistive tech and the tab order while away", () => {
    render(<JumpToLatestButton visible={false} onClick={vi.fn()} />);
    const button = screen.getByTestId("chat-jump-to-latest");
    expect(button.getAttribute("aria-hidden")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(button.className).not.toContain("is-visible");
  });

  it("becomes reachable when shown", () => {
    render(<JumpToLatestButton visible onClick={vi.fn()} />);
    const button = screen.getByTestId("chat-jump-to-latest");
    expect(button.getAttribute("aria-hidden")).toBe("false");
    expect(button.getAttribute("tabindex")).toBe("0");
    expect(button.className).toContain("is-visible");
  });

  it("stays mounted so it can fade rather than pop", () => {
    const { rerender } = render(
      <JumpToLatestButton visible={false} onClick={vi.fn()} />,
    );
    const before = screen.getByTestId("chat-jump-to-latest");
    rerender(<JumpToLatestButton visible onClick={vi.fn()} />);
    expect(screen.getByTestId("chat-jump-to-latest")).toBe(before);
  });

  it("calls back when clicked", async () => {
    const onClick = vi.fn();
    render(<JumpToLatestButton visible onClick={onClick} />);
    await userEvent.click(screen.getByTestId("chat-jump-to-latest"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows the label it is given", () => {
    render(
      <JumpToLatestButton visible onClick={vi.fn()} label="New response" />,
    );
    expect(screen.getByText("New response")).toBeTruthy();
  });

  it("badges how much arrived while the reader was away", () => {
    render(<JumpToLatestButton visible onClick={vi.fn()} pendingCount={12} />);
    // Past nine it stops being a useful number and starts being clutter.
    expect(screen.getByTestId("chat-jump-badge").textContent).toBe("9+");
  });

  it("shows a small count exactly", () => {
    render(<JumpToLatestButton visible onClick={vi.fn()} pendingCount={3} />);
    expect(screen.getByTestId("chat-jump-badge").textContent).toBe("3");
  });

  it("has no badge when nothing new arrived", () => {
    render(<JumpToLatestButton visible onClick={vi.fn()} pendingCount={0} />);
    expect(screen.queryByTestId("chat-jump-badge")).toBeNull();
  });

  it("turns the ring only while output is still arriving", () => {
    const { rerender } = render(
      <JumpToLatestButton visible onClick={vi.fn()} isStreaming />,
    );
    expect(screen.getByTestId("chat-jump-ring")).toBeTruthy();

    rerender(<JumpToLatestButton visible onClick={vi.fn()} />);
    expect(screen.queryByTestId("chat-jump-ring")).toBeNull();
  });

  it("announces the backlog to screen readers", () => {
    render(<JumpToLatestButton visible onClick={vi.fn()} pendingCount={4} />);
    expect(
      screen.getByTestId("chat-jump-to-latest").getAttribute("aria-label"),
    ).toBe("Jump to Live — 4 new");
  });
});
