import { describe, expect, it } from "vitest";
import {
  FREE_AGENT_GITHUB_STAR_BONUS_MESSAGES,
  getFreeAgentGithubStarBonusMessages,
} from "@/lib/free_agent_quota_limit";

const QUOTA_WINDOW_MS = 23 * 60 * 60 * 1000;

describe("free agent quota bonus", () => {
  it("returns the GitHub star bonus inside the quota window", () => {
    expect(
      getFreeAgentGithubStarBonusMessages(
        { freeAgentGithubStarBonusClaimedAt: 10_000 },
        10_000 + QUOTA_WINDOW_MS - 1,
        QUOTA_WINDOW_MS,
      ),
    ).toBe(FREE_AGENT_GITHUB_STAR_BONUS_MESSAGES);
  });

  it("expires the GitHub star bonus after the quota window", () => {
    expect(
      getFreeAgentGithubStarBonusMessages(
        { freeAgentGithubStarBonusClaimedAt: 10_000 },
        10_000 + QUOTA_WINDOW_MS,
        QUOTA_WINDOW_MS,
      ),
    ).toBe(0);
  });
});
