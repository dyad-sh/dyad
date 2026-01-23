import { readSettings } from "../../main/settings";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { createLoggedHandler } from "./safe_handle";
import { transcribeWithDyadEngine } from "../utils/llm_engine_provider";

const logger = log.scope("transcription");
const handle = createLoggedHandler(logger);

export function registerTranscriptionHandlers() {
  handle(
    "chat:transcribe",
    async (
      event,
      { audioData, format }: { audioData: string; format: string },
    ) => {
      try {
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
