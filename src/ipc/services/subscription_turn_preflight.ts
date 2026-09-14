import type { ModelSelection, UserSettings } from "@/lib/schemas";
import { resolveSubscriptionModel } from "./resolve_subscription_model";
import { getCodexSubscriptionCredentials } from "./codex_subscription_auth";
import { checkSubscriptionCredits } from "./codex_subscription_credit_check";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Resolve once before durable acceptance. In-flight turns keep this selection. */
export async function preflightSubscriptionTurn(
  model: ModelSelection,
  settings: UserSettings,
  signal: AbortSignal,
): Promise<ModelSelection> {
  const resolved = await resolveSubscriptionModel(model, settings);
  if (resolved.connection === "subscription")
    await getCodexSubscriptionCredentials();
  if (
    resolved.connection === "subscription" ||
    resolved.connection === "api-key"
  ) {
    const apiKey = settings.providerSettings?.auto?.apiKey?.value;
    if (!apiKey)
      throw new DyadError(
        "Connect Dyad Pro before using an external model.",
        DyadErrorKind.Auth,
      );
    await checkSubscriptionCredits(apiKey, signal);
    signal.throwIfAborted();
  }
  return resolved;
}
