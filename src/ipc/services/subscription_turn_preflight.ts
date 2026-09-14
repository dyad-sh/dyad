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
  if (settings.proModelUsage === "pro" || model.provider !== "openai")
    return { ...identity, connection: "pro" };
  const account = await getSubscriptionAccount();
  if (account.error) throw new DyadError(account.error, DyadErrorKind.Auth);
  if (account.connected && account.modelsError && !account.models.length)
    throw new DyadError(
      "Subscription model availability is unavailable. Try again or select Pro credits in the Pro menu.",
      DyadErrorKind.External,
    );
  if (!usesChatGPTSubscription(model, settings, account))
    return { ...identity, connection: "pro" };
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
