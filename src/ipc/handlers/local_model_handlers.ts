import { registerOllamaHandlers } from "./local_model_ollama_handler";
import { registerLMStudioHandlers } from "./local_model_lmstudio_handler";
import { registerLocalModelDiscoveryHandlers } from "./local_model_discovery_handler";

export function registerLocalModelHandlers() {
  registerOllamaHandlers();
  registerLMStudioHandlers();
  registerLocalModelDiscoveryHandlers();
}
