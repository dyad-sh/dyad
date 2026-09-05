import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
vi.mock("@/hooks/useCountTokens", () => ({ useCountTokens: vi.fn() }));
import { SubscriptionUsage } from "./TokenBar";

it("shows the separate pricing rule and test-only receipt", () => {
  render(
    <SubscriptionUsage
      receipt={JSON.stringify({ status: "test-settled", chargeUsd: "0.003" })}
    />,
  );
  expect(
    screen.getByText(/Test charge \(no live debit\): \$0.003/),
  ).toBeTruthy();
  expect(screen.getByText(/25%.*\$0.10/)).toBeTruthy();
});
it("does not present an incomplete receipt as a zero charge", () => {
  render(
    <SubscriptionUsage
      receipt={JSON.stringify({ status: "reconciliation", chargeUsd: "0" })}
    />,
  );
  expect(screen.getByText(/cost unavailable/)).toBeTruthy();
  expect(screen.queryByText(/Latest Dyad charge/)).toBeNull();
});
