import type { UserSettings } from "./schemas";

/** Base number of Basic Agent (free tier) messages per quota window */
export const FREE_AGENT_QUOTA_LIMIT = 10;

/** One-time Basic Agent message bonus for starring the Dyad GitHub repo */
export const FREE_AGENT_GITHUB_STAR_BONUS_MESSAGES = 10;

export function getFreeAgentGithubStarBonusMessages(
  settings: Pick<UserSettings, "freeAgentGithubStarBonusClaimedAt">,
  now: number,
  quotaWindowMs: number,
): number {
  const claimedAt = settings.freeAgentGithubStarBonusClaimedAt;
  if (!claimedAt) {
    return 0;
  }

  return now < claimedAt + quotaWindowMs
    ? FREE_AGENT_GITHUB_STAR_BONUS_MESSAGES
    : 0;
}
