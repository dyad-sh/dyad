import { ipcMain } from "electron";
import { streamText } from "ai";
import log from "electron-log";
import { readSettings } from "../../main/settings";
import { getModelClient } from "../utils/get_model_client";
import { getMaxTokens, getTemperature } from "../utils/token_utils";

const logger = log.scope("prompt_enhance_handlers");

export function registerPromptEnhanceHandlers() {
  ipcMain.handle(
    "prompt:enhance",
    async (_event, params: { prompt: string }) => {
      const { prompt } = params || {};
      if (!prompt || !prompt.trim()) {
        throw new Error("Prompt is empty");
      }

      const settings = await readSettings();
      const { modelClient } = await getModelClient(
        settings.selectedModel,
        settings,
      );

      const system = `You are an expert prompt engineer. Improve the user's prompt so an AI can produce the best possible result.
- Preserve intent and constraints.
- Make it specific, unambiguous, and structured.
- Add clarifying details only if they are reasonable defaults.
- Keep language/style consistent with the original.
- Return only the improved prompt with no preamble or explanation.`;

      let enhanced = "";
      try {
        const { fullStream } = await streamText({
          model: modelClient.model,
          system,
          messages: [
            { role: "user", content: prompt },
          ],
          maxOutputTokens: Math.min(512, await getMaxTokens(settings.selectedModel)),
          temperature: Math.max(0, Math.min(1, (await getTemperature(settings.selectedModel)) * 0.6)),
          maxRetries: 1,
        });

        for await (const part of fullStream) {
          if (part.type === "text-delta") {
            enhanced += part.text;
          }
        }

        enhanced = (enhanced || "").trim();
        return { enhancedPrompt: enhanced } as const;
      } catch (err) {
        logger.error("prompt:enhance error", err);
        throw err instanceof Error ? err : new Error(String(err));
      }
    },
  );
}
