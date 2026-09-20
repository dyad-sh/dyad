import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { NeonAuthWarning } from "./NeonAuthWarning";

it("keeps the warning visible until recovery and invokes the existing restart action", () => {
  const restart = vi.fn();
  const view = render(
    <NeonAuthWarning
      message="Authentication registration failed for this app."
      onRetry={restart}
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Authentication registration failed",
  );
  fireEvent.click(screen.getByRole("button", { name: "Restart and retry" }));
  expect(restart).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("status")).toBeTruthy();
  view.rerender(<NeonAuthWarning onRetry={restart} />);
  expect(screen.queryByRole("status")).toBeNull();
});
