import fetch from "node-fetch"; // Electron main process might need node-fetch
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { readSettings } from "../../main/settings"; // Assuming settings are read this way
import { UserBudgetInfo, UserBudgetInfoSchema } from "../ipc_types";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { z } from "zod";

export const UserInfoResponseSchema = z.object({
  usedCredits: z.number(),
  totalCredits: z.number(),
  budgetResetDate: z.string(), // ISO date string from API
  userId: z.string(),
});
export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;

const logger = log.scope("pro_handlers");
const handle = createLoggedHandler(logger);

export function registerProHandlers() {
  // This method should try to avoid throwing errors because this is auxiliary
  // information and isn't critical to using the app
  handle("get-user-budget", async (): Promise<UserBudgetInfo | null> => {
    if (IS_TEST_BUILD) {
      // Return mock budget data for E2E tests instead of spamming the API
      const resetDate = new Date();
      resetDate.setDate(resetDate.getDate() + 30); // Reset in 30 days
      return {
        usedCredits: 100,
        totalCredits: 1000,
        budgetResetDate: resetDate,
        redactedUserId: "<redacted-user-id-testing>",
      };
    }
    logger.info("Attempting to fetch user budget information.");

    const settings = readSettings();

    const apiKey = settings.providerSettings?.auto?.apiKey?.value;

    if (!apiKey) {
      logger.error("LLM Gateway API key (Dyad Pro) is not configured.");
      return null;
    }

    const url = "https://api.dyad.sh/v1/user/info";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };

    try {
      // Use native fetch if available, otherwise node-fetch will be used via import
      const response = await fetch(url, {
        method: "GET",
        headers: headers,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(
          `Failed to fetch user budget. Status: ${response.status}. Body: ${errorBody}`,
        );
        return null;
      }

      const rawData = await response.json();

      // Validate the API response structure
      const data = UserInfoResponseSchema.parse(rawData);

      // Turn user_abc1234 =>  "****1234"
      // Preserve the last 4 characters so we can correlate bug reports
      // with the user.
      const redactedUserId =
        data.userId.length > 8 ? "****" + data.userId.slice(-4) : "<redacted>";

      logger.info("Successfully fetched user budget information.");

      // Transform to UserBudgetInfo format
      const userBudgetInfo = UserBudgetInfoSchema.parse({
        usedCredits: data.usedCredits,
        totalCredits: data.totalCredits,
        budgetResetDate: new Date(data.budgetResetDate),
        redactedUserId: redactedUserId,
      });

      return userBudgetInfo;
    } catch (error: any) {
      logger.error(`Error fetching user budget: ${error.message}`, error);
      return null;
    }
  });
}
