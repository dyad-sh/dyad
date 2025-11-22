import { readSettings } from "../../main/settings";
import fs from "fs";
import path from "path";
import os from "os";
import OpenAI from "openai";
import log from "electron-log";
const logger = log.scope("chat_handlers");
import { createLoggedHandler } from "./safe_handle";
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

        // Get OpenAI API Key
        const apiKey = settings.providerSettings?.openai?.apiKey?.value;

        if (!apiKey) {
          throw new Error(
            "OpenAI API Key not found. Please configure it in settings.",
          );
        }

        const openai = new OpenAI({ apiKey });

        // Create a temporary file for the audio
        const tempDir = os.tmpdir();
        const tempFilePath = path.join(
          tempDir,
          `recording-${Date.now()}.${format}`,
        );

        // Convert base64 to buffer
        const buffer = Buffer.from(audioData, "base64");
        fs.writeFileSync(tempFilePath, buffer);

        try {
          const transcription = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempFilePath),
            model: "whisper-1",
          });

          return transcription.text;
        } finally {
          // Clean up temp file
          if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
          }
        }
      } catch (error) {
        console.error("Transcription error:", error);
        throw new Error(`Transcription failed: ${(error as Error).message}`);
      }
    },
  );
}
