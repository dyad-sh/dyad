import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn((options) => options),
  getSubscriptionStatus: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({ useQuery: mocks.useQuery }));
vi.mock("@/ipc/types", () => ({
  ipc: { system: { getSubscriptionStatus: mocks.getSubscriptionStatus } },
}));

import {
  SUBSCRIPTION_STATUS_REFRESH_INTERVAL_MS,
  useSubscriptionStatus,
} from "./useSubscriptionStatus";

describe("useSubscriptionStatus", () => {
  it("refreshes hourly, on focus, and without retries", async () => {
    const options = useSubscriptionStatus() as unknown as {
      staleTime: number;
      refetchInterval: number;
      refetchOnWindowFocus: "always";
      retry: boolean;
      queryFn: () => Promise<unknown>;
    };
    expect(options).toMatchObject({
      staleTime: SUBSCRIPTION_STATUS_REFRESH_INTERVAL_MS,
      refetchInterval: SUBSCRIPTION_STATUS_REFRESH_INTERVAL_MS,
      refetchOnWindowFocus: "always",
      retry: false,
    });
    await options.queryFn();
    expect(mocks.getSubscriptionStatus).toHaveBeenCalledOnce();
  });
});
