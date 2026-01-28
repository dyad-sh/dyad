import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { ipcMain } from "electron";
import { readSettings } from "../../main/settings";
import { transcribeWithDyadEngine } from "../utils/llm_engine_provider";
import { miscContracts } from "../types/misc";

const logger = log.scope("transcription");

const E2E_TRANSCRIBED_TEXT = "E2E transcribed text";
const MAX_AUDIO_BASE64_LENGTH = 10 * 1024 * 1024;
const ALLOWED_AUDIO_FORMATS = new Set(["webm", "mp3", "wav", "m4a"]);

export function registerTranscriptionHandlers() {
  ipcMain.handle(
    "chat:transcribe",
    async (event, input: { audioData: string; format: string }) => {
      try {
        const { audioData, format } =
          miscContracts.transcribeAudio.input.parse(input);
        if (audioData.length > MAX_AUDIO_BASE64_LENGTH) {
          throw new Error("Audio payload exceeds maximum allowed size.");
        }
        const normalizedFormat = format.trim().toLowerCase();
        if (!ALLOWED_AUDIO_FORMATS.has(normalizedFormat)) {
          throw new Error("Unsupported audio format.");
        }
        // In E2E test mode, return mock transcription
        if (process.env.E2E_TEST_BUILD === "true") {
          logger.info("E2E test mode: returning mock transcription");
          return E2E_TRANSCRIBED_TEXT;
        }

        const settings = readSettings();
        const dyadEngineUrl = process.env.DYAD_ENGINE_URL;
        const dyadApiKey = settings.providerSettings?.auto?.apiKey?.value;
        if (!dyadApiKey) {
          logger.error("Dyad API key is missing");
          throw new Error(
            "Dyad Pro API key is required for voice transcription",
          );
        }

        const buffer = Buffer.from(audioData, "base64");
        const filename = `recording-${Date.now()}.${normalizedFormat}`;
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
