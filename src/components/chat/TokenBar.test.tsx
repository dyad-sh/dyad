import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/hooks/useCountTokens", () => ({ useCountTokens: vi.fn() }));
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
it("identifies turns accepted with Pro off", () => {
  render(
    <SubscriptionUsage receipt={JSON.stringify({ status: "unbilled" })} />,
  );
  expect(screen.getByText(/no Dyad credits charged/)).toBeTruthy();
});
