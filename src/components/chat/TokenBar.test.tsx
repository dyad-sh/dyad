import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/useCountTokens", () => ({ useCountTokens: vi.fn() }));
vi.mock("@/hooks/useChatStream", () => ({ useChatStreamState: vi.fn() }));
import { SubscriptionUsage } from "./TokenBar";
afterEach(cleanup);
it("shows flat Pro pricing without presenting a reporting attempt as a settled charge", () => {
  render(
    <SubscriptionUsage receipt={JSON.stringify({ status: "attempted" })} />,
  );
  expect(screen.getByText(/Usage reporting attempted/)).toBeTruthy();
  expect(screen.getByText(/\$0.02.*\$0.10/)).toBeTruthy();
});
it("does not present missing usage as a zero charge", () => {
  render(<SubscriptionUsage />);
  expect(screen.getByText(/Usage unavailable/)).toBeTruthy();
});
it("identifies turns accepted with Pro off or in an unbilled mode", () => {
  render(
    <SubscriptionUsage receipt={JSON.stringify({ status: "unbilled" })} />,
  );
  expect(
    screen.getByText(/does not use Dyad credits.*Build, Ask or Plan/),
  ).toBeTruthy();
});

it.each(["empty", "pending"] as const)(
  "shows %s usage without a reporting-failure message",
  (phase) => {
    render(
      <SubscriptionUsage
        phase={phase}
        receipt={JSON.stringify({ status: "attempted" })}
      />,
    );
    expect(
      screen.queryByText(/Usage unavailable|Usage reporting attempted/),
    ).toBeNull();
    expect(
      screen.getByText(
        phase === "empty"
          ? /after your first turn/
          : /after this turn completes/,
      ),
    ).toBeTruthy();
  },
);
