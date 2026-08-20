import { describe, expect, it } from "vitest";
import { shouldSimulateFreeAgentQuotaExceeded } from "./free_agent_quota_fixture";

describe("shouldSimulateFreeAgentQuotaExceeded", () => {
  it("enables the fixture in development when explicitly requested", () => {
    expect(
      shouldSimulateFreeAgentQuotaExceeded({
        NODE_ENV: "development",
        DYAD_SIMULATE_FREE_AGENT_QUOTA_EXCEEDED: "true",
      }),
    ).toBe(true);
  });

  it("never enables the fixture in production", () => {
    expect(
      shouldSimulateFreeAgentQuotaExceeded({
        NODE_ENV: "production",
        DYAD_SIMULATE_FREE_AGENT_QUOTA_EXCEEDED: "true",
      }),
    ).toBe(false);
  });

  it("requires an explicit opt-in", () => {
    expect(
      shouldSimulateFreeAgentQuotaExceeded({ NODE_ENV: "development" }),
    ).toBe(false);
  });
});
