import type { ModelSelection } from "@/lib/schemas";

export const INFERENCE_SOURCES = [
  "subscription",
  "pro",
  "api-key",
  "local",
] as const;
export type InferenceSource = (typeof INFERENCE_SOURCES)[number];

export function getInferenceSource(
  model: Pick<ModelSelection, "provider" | "connection">,
  isEngineEnabled: boolean,
): InferenceSource {
  if (model.connection === "subscription") return "subscription";
  if (["ollama", "lmstudio"].includes(model.provider)) return "local";
  if (model.connection === "pro" || isEngineEnabled) return "pro";
  return "api-key";
}
