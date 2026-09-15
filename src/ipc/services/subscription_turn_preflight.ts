import type { ModelSelection, UserSettings } from "@/lib/schemas";
import { resolveSubscriptionModel } from "./resolve_subscription_model";
import { getCodexSubscriptionCredentials } from "./codex_subscription_auth";
import { checkSubscriptionCredits } from "./codex_subscription_credit_check";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getAutoSidekickRuntimeModel } from "@/lib/autoSidekick";
import {
  AUTO_BALANCED_ALIAS,
  AUTO_DYAD_PRO_MODEL_ALIASES,
  resolveAutoModelCandidate,
  type AutoModelCandidates,
} from "./auto_model_candidates";

/** Resolve once before durable acceptance. In-flight turns keep this selection. */
export async function preflightSubscriptionTurn(
  model: ModelSelection,
  settings: UserSettings,
  signal: AbortSignal,
  autoModelCandidates?: AutoModelCandidates,
): Promise<ModelSelection> {
  signal.throwIfAborted();
  const resolved = await resolveSubscriptionModel(model, settings);
  const selections = [resolved];
  const runtimeModel = getAutoSidekickRuntimeModel(resolved);
  if (runtimeModel.provider === "auto" && resolved.connection === "pro") {
    const aliases =
      runtimeModel.name === "balanced"
        ? [AUTO_BALANCED_ALIAS]
        : runtimeModel.name === "auto"
          ? AUTO_DYAD_PRO_MODEL_ALIASES
          : [];
    for (const alias of aliases) {
      const candidate = await resolveAutoModelCandidate(alias, settings);
      signal.throwIfAborted();
      autoModelCandidates?.set(alias, candidate);
      if (candidate) selections.push(candidate.selection);
    }
  }
  signal.throwIfAborted();
  if (selections.some((selection) => selection.connection === "subscription"))
    await getCodexSubscriptionCredentials();
  if (
    selections.some(
      (selection) =>
        selection.connection === "subscription" ||
        selection.connection === "api-key",
    )
  ) {
    const apiKey = settings.providerSettings?.auto?.apiKey?.value;
    if (!apiKey)
      throw new DyadError(
        "Connect Dyad Pro before using an external model.",
        DyadErrorKind.Auth,
      );
    await checkSubscriptionCredits(apiKey, signal);
  }
  signal.throwIfAborted();
  return resolved;
}
