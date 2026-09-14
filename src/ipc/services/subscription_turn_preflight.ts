import { getLanguageModelProviders } from "../shared/language_model_helpers";
import type { ModelSelection, UserSettings } from "@/lib/schemas";
import { usesChatGPTSubscription } from "@/lib/subscriptionModels";
import { getSubscriptionAccount } from "./codex_subscription_account";
import { getCodexSubscriptionCredentials } from "./codex_subscription_auth";
import { checkSubscriptionCredits } from "./codex_subscription_credit_check";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Resolve once before durable acceptance. In-flight turns keep this selection. */
export async function preflightSubscriptionTurn(
  model: ModelSelection,
  settings: UserSettings,
  signal: AbortSignal,
): Promise<ModelSelection> {
  const { connection: _legacyConnection, ...identity } = model;
  if (
    !settings.enableDyadPro ||
    !settings.providerSettings?.auto?.apiKey?.value
  )
    return identity;
  const provider = (await getLanguageModelProviders()).find(
    (p) => p.id === model.provider,
  );
  if (
    ["ollama", "lmstudio"].includes(model.provider) ||
    provider?.type === "custom"
  ) {
    await checkSubscriptionCredits(
      settings.providerSettings.auto.apiKey.value,
      signal,
    );
    signal.throwIfAborted();
    return { ...identity, connection: "api-key" };
  }
  if (settings.proModelUsage === "pro" || model.provider !== "openai")
    return { ...identity, connection: "pro" };
  const account = await getSubscriptionAccount();
  // An abandoned sign-in can leave a status error without a connection. It
  // belongs in the account UI and must not block ordinary Pro-credit turns.
  if (!account.connected) return { ...identity, connection: "pro" };
  // With no catalog, eligibility is unknown. Do not silently change the
  // billing source of a potentially subscription-eligible model on an outage.
  if (account.modelsError && !account.models.length)
    throw new DyadError(
      "Subscription model availability is unavailable. Try again or select Pro credits in the Pro menu.",
      DyadErrorKind.External,
    );
  if (!usesChatGPTSubscription(model, settings, account))
    return { ...identity, connection: "pro" };
  if (account.error) throw new DyadError(account.error, DyadErrorKind.Auth);
  await getCodexSubscriptionCredentials();
  const key = settings.providerSettings?.auto?.apiKey?.value;
  if (!key)
    throw new DyadError(
      "Connect Dyad Pro before using your ChatGPT subscription.",
      DyadErrorKind.Auth,
    );
  await checkSubscriptionCredits(key, signal);
  signal.throwIfAborted();
  return { ...identity, connection: "subscription" };
}
