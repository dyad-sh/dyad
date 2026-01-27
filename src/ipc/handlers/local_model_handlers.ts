import { registerOllamaHandlers } from "./local_model_ollama_handler";
import { registerLMStudioHandlers } from "./local_model_lmstudio_handler";
import log from "electron-log";

const logger = log.scope("local_models");

export function registerLocalModelHandlers() {
  logger.info("Registering local model handlers...");
  registerOllamaHandlers();
  registerLMStudioHandlers();
  logger.info("Local model handlers registered");
}
