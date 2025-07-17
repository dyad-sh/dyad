import { readSettings } from "../../main/settings";
import log from "electron-log";
import { IS_TEST_BUILD } from "./test_utils";

const logger = log.scope("vercel_utils");

// Use test server URLs when in test mode
const TEST_SERVER_BASE = "http://localhost:3500";

const VERCEL_API_BASE = IS_TEST_BUILD
  ? `${TEST_SERVER_BASE}/vercel/api`
  : "https://api.vercel.com";

export async function getVercelTeamSlug(
  teamId: string,
): Promise<string | null> {
  try {
    const settings = readSettings();
    const accessToken = settings.vercelAccessToken?.value;

    if (!accessToken) {
      logger.warn("No Vercel access token found when trying to get team slug");
      return null;
    }

    const response = await fetch(`${VERCEL_API_BASE}/v2/teams/${teamId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      logger.error(
        `Failed to fetch team details: ${response.status} ${response.statusText}`,
      );
      return null;
    }

    const data = await response.json();

    // Return the team slug if available
    return data.slug || null;
  } catch (error) {
    logger.error("Error getting Vercel team slug:", error);
    return null;
  }
}
