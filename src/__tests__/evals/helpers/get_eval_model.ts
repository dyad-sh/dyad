import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type { LanguageModel } from "./pi_eval_compat";

export type EvalProvider = "anthropic" | "openai" | "google";

export const GPT_5_4 = "gpt-5.4";

const models = builtinModels();

const PROVIDER_ENV_VARS: Record<EvalProvider, readonly string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
};

export function hasEvalProviderKey(provider?: EvalProvider): boolean {
  const providers = provider
    ? [provider]
    : (Object.keys(PROVIDER_ENV_VARS) as EvalProvider[]);
  return providers.some((providerId) =>
    PROVIDER_ENV_VARS[providerId].some((name) => !!process.env[name]?.trim()),
  );
}

export function getEvalModel(
  provider: EvalProvider,
  modelName: string,
): LanguageModel {
  const model = models.getModel(provider, modelName);
  if (!model) {
    throw new Error(`Unknown pi eval model: ${provider}/${modelName}`);
  }
  return { model, models };
}
