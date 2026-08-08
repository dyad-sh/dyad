import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GeneratingImageCard } from "./GeneratingImageCard";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GeneratingImageCard", () => {
  it("renders a placeholder immediately", () => {
    render(<GeneratingImageCard />);
    const card = screen.getByTestId("generating-image-card");
    expect(card).toBeTruthy();
    expect(card.classList.contains("chat-card-fly-in")).toBe(true);
    expect(screen.getByText("Generating image")).toBeTruthy();
    expect(card.querySelector(".holo-dot-field")).toBeTruthy();
    expect(screen.getByText("Analyzing request")).toBeTruthy();
  });

  it("uses the same creation canvas for video generation", () => {
    render(<GeneratingImageCard label="Generating video" />);

    expect(screen.getByText("Generating video")).toBeTruthy();
    expect(
      screen
        .getByTestId("generating-image-card")
        .querySelector(".holo-dot-plane--b"),
    ).toBeTruthy();
  });

  it("advances through the stages as time passes", () => {
    render(<GeneratingImageCard />);
    expect(screen.getByText("Analyzing request")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText("Selecting composition")).toBeTruthy();
  });

  it("marks passed stages as done", () => {
    render(<GeneratingImageCard />);
    act(() => {
      vi.advanceTimersByTime(8000);
    });

    expect(
      screen.getAllByTestId("generation-stage-done").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByTestId("generation-stage-active")).toHaveLength(1);
  });

  it("keeps a live region so the stage is announced", () => {
    render(<GeneratingImageCard />);
    const card = screen.getByTestId("generating-image-card");
    expect(card.getAttribute("aria-live")).toBe("polite");
    expect(card.getAttribute("aria-label")).toContain("Analyzing request");
  });

  it("settles on the final stage rather than appearing stalled", () => {
    render(<GeneratingImageCard />);
    act(() => {
      vi.advanceTimersByTime(120_000);
    });

    expect(screen.getByText("Finalizing")).toBeTruthy();
    expect(screen.getAllByTestId("generation-stage-active")).toHaveLength(1);
  });

  it("stops its timer when unmounted", () => {
    const { unmount } = render(<GeneratingImageCard />);
    unmount();
    // A leaked interval would throw on an unmounted component.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });

  it("can display a real externally controlled pipeline stage", () => {
    render(
      <GeneratingImageCard
        label="Adding documents"
        stages={[
          { label: "Uploading documents", startsAtMs: 0 },
          { label: "Indexing documents", startsAtMs: 1 },
        ]}
        activeStageIndex={1}
      />,
    );

    expect(
      screen
        .getByText("Uploading documents")
        .closest("li")
        ?.classList.contains("holo-stage--done"),
    ).toBe(true);
    expect(
      screen
        .getByText("Indexing documents")
        .closest("li")
        ?.classList.contains("holo-stage--active"),
    ).toBe(true);
  });
});
