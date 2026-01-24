import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { ipcMain } from "electron";
import { readSettings } from "../../main/settings";
import { transcribeWithDyadEngine } from "../utils/llm_engine_provider";

const logger = log.scope("transcription");

const E2E_TRANSCRIBED_TEXT = "E2E transcribed text";

export function registerTranscriptionHandlers() {
  ipcMain.handle(
    "chat:transcribe",
    async (
      event,
      { audioData, format }: { audioData: string; format: string },
    ) => {
      try {
        // In E2E test mode, return mock transcription
        if (process.env.E2E_TEST_BUILD === "true") {
          logger.info("E2E test mode: returning mock transcription");
          return E2E_TRANSCRIBED_TEXT;
        }

        const settings = readSettings();
        const dyadEngineUrl = process.env.DYAD_ENGINE_URL;
        const dyadApiKey = settings.providerSettings?.auto?.apiKey?.value;

        const buffer = Buffer.from(audioData, "base64");
        const filename = `recording-${Date.now()}.${format}`;
        const requestId = uuidv4();

        logger.info("Using Dyad Engine for transcription");
        return await transcribeWithDyadEngine(buffer, filename, requestId, {
          apiKey: dyadApiKey,
          baseURL: dyadEngineUrl ?? "https://engine.dyad.sh/v1",
          dyadOptions: {},
          settings,
        });
      } catch (error) {
        logger.error("Transcription error:", error);
        throw new Error(`Transcription failed: ${(error as Error).message}`);
      }
    },
  );
}
