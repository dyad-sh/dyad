import { registerOllamaHandlers } from "./local_model_ollama_handler";
import { registerLMStudioHandlers } from "./local_model_lmstudio_handler";
import { registerOllamaRegistryHandlers } from "./ollama_registry_handler";

export function registerLocalModelHandlers() {
  registerOllamaHandlers();
  registerLMStudioHandlers();
  registerOllamaRegistryHandlers();
}
