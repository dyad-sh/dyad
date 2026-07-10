import fetch from "node-fetch"; // Electron main process might need node-fetch
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { createLoggedTypedHandler } from "./base";
import { readSettings } from "../../main/settings"; // Assuming settings are read this way
import { UserBudgetInfo, UserBudgetInfoSchema } from "@/ipc/types";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { z } from "zod";
import {
  audioContracts,
  MAX_AUDIO_FILENAME_LENGTH,
  MAX_AUDIO_RECORDING_BYTES,
  MAX_AUDIO_REQUEST_ID_LENGTH,
} from "../types/audio";
import type { TranscribeAudioParams } from "../types/audio";
import { transcribeWithDyadEngine } from "../utils/llm_engine_provider";
import { getDyadEngineBaseUrl } from "../utils/dyad_engine_url";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

export const UserInfoResponseSchema = z.object({
  usedCredits: z.number(),
  totalCredits: z.number(),
  budgetResetDate: z.string(), // ISO date string from API
  userId: z.string(),
  isTrial: z.boolean().optional().default(false),
});
export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;

const logger = log.scope("pro_handlers");
const handle = createLoggedHandler(logger);
const typedHandle = createLoggedTypedHandler(logger);

function validateAudioTranscriptionRequest(input: TranscribeAudioParams) {
  if (
    input.audioData.byteLength === 0 ||
    input.audioData.byteLength > MAX_AUDIO_RECORDING_BYTES
  ) {
    throw new DyadError(
      `Audio data must be between 1 and ${MAX_AUDIO_RECORDING_BYTES} bytes`,
      DyadErrorKind.Validation,
    );
  }

  if (
    input.filename.trim().length === 0 ||
    input.filename.length > MAX_AUDIO_FILENAME_LENGTH ||
    input.filename.includes("/") ||
    input.filename.includes("\\")
  ) {
    throw new DyadError("Invalid audio filename", DyadErrorKind.Validation);
  }

  if (
    input.requestId.trim().length === 0 ||
    input.requestId.length > MAX_AUDIO_REQUEST_ID_LENGTH
  ) {
    throw new DyadError(
      "Invalid transcription request ID",
      DyadErrorKind.Validation,
    );
  }
}

function getUserInfoUrl() {
  // Overridable so tests point at the fake LLM server instead of the real API.
  if (process.env.DYAD_USER_INFO_URL) {
    return process.env.DYAD_USER_INFO_URL;
  }
  return "https://api.dyad.sh/v1/user/info";
}

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
        isTrial: false,
      };
    }
    logger.debug("Attempting to fetch user budget information.");

    const settings = readSettings();

    const apiKey = settings.providerSettings?.auto?.apiKey?.value;

    if (!apiKey) {
      // Expected state for non-Pro users; not an error.
      logger.debug("LLM Gateway API key (Dyad Pro) is not configured.");
      return null;
    }

    const url = getUserInfoUrl();
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

      logger.debug("Successfully fetched user budget information.");

      // Transform to UserBudgetInfo format
      const userBudgetInfo = UserBudgetInfoSchema.parse({
        usedCredits: data.usedCredits,
        totalCredits: data.totalCredits,
        budgetResetDate: new Date(data.budgetResetDate),
        redactedUserId: redactedUserId,
        isTrial: data.isTrial,
      });

      return userBudgetInfo;
    } catch (error: any) {
      logger.error(`Error fetching user budget: ${error.message}`, error);
      return null;
    }
  });

  typedHandle(
    audioContracts.transcribeAudio,
    async (_event, input: TranscribeAudioParams) => {
      const settings = readSettings();
      const apiKey = settings.providerSettings?.auto?.apiKey?.value;

      if (!apiKey || !settings.enableDyadPro) {
        throw new Error(
          "Dyad Pro is not enabled. Voice-to-text requires a Pro subscription.",
        );
      }

      validateAudioTranscriptionRequest(input);

      const audioBuffer = Buffer.from(
        input.audioData.buffer,
        input.audioData.byteOffset,
        input.audioData.byteLength,
      );

      const text = await transcribeWithDyadEngine(
        audioBuffer,
        input.filename,
        input.requestId,
        {
          apiKey,
          baseURL: getDyadEngineBaseUrl(),
          dyadOptions: {},
          settings,
        },
      );

      return { text };
    },
  );
}
