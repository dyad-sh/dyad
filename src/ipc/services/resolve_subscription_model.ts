import { getLanguageModelProviders } from "../shared/language_model_helpers";
import {
  isDyadProEnabled,
  type ModelSelection,
  type UserSettings,
} from "@/lib/schemas";
import {
  getSubscriptionDefaultModel,
  isChatGPTAutoSelection,
  usesChatGPTSubscription,
} from "@/lib/subscriptionModels";
import { getSubscriptionAccount } from "./codex_subscription_account";
import { resolveModelSelection } from "../utils/model_effort";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/** Choose the source for a concrete model, shared by chat and auxiliary calls. */
export async function resolveSubscriptionModel(
  model: ModelSelection,
  settings: UserSettings,
): Promise<ModelSelection> {
  const { connection: _legacyConnection, ...identity } = model;
  if (settings.proModelUsage === "api-key") {
    if (model.provider === "claude-code")
      throw new DyadError(
        "This chat uses Claude Code. Select Subscriptions, or choose an API-key model to start a new chat.",
        DyadErrorKind.Validation,
      );
    return { ...identity, connection: "api-key" };
  }
  if (model.provider === "claude-code")
    return { ...identity, connection: "subscription" };
  const proEnabled = isDyadProEnabled(settings);
  const fallback = proEnabled
    ? { ...identity, connection: "pro" as const }
    : identity;
  const subscriptionAuto = !proEnabled && isChatGPTAutoSelection(model);
  if (!proEnabled && model.provider !== "openai" && !subscriptionAuto)
    return identity;
  const provider = (await getLanguageModelProviders()).find(
    (p) => p.id === model.provider,
  );
  if (
    ["ollama", "lmstudio"].includes(model.provider) ||
    provider?.type === "custom"
  ) {
    return proEnabled ? { ...identity, connection: "api-key" } : identity;
  }
  if (
    settings.proModelUsage === "pro" ||
    (model.provider !== "openai" && !subscriptionAuto)
  )
    return fallback;
  const account = await getSubscriptionAccount({ includeUsage: false });
  if (account.credentialError)
    throw new DyadError(
      proEnabled
        ? "Saved ChatGPT credentials could not be opened. Reconnect your ChatGPT subscription or select Pro credits in the Pro menu."
        : "Saved ChatGPT credentials could not be opened. Reconnect ChatGPT, or disconnect it in the model picker to use your OpenAI API key.",
      DyadErrorKind.Auth,
    );
  // An abandoned sign-in can leave a status error without a connection. It
  // belongs in the account UI and must not block ordinary Pro-credit turns.
  if (!account.connected) return fallback;
  if (account.error && !account.models.length)
    throw new DyadError(account.error, DyadErrorKind.Auth);
  // With no catalog, eligibility is unknown. Do not silently change the
  // billing source of a potentially subscription-eligible model on an outage.
  if (account.modelsError && !account.models.length)
    throw new DyadError(
      proEnabled
        ? "Subscription model availability is unavailable. Try again or select Pro credits in the Pro menu."
        : "Subscription model availability is unavailable. Try again or choose another available model.",
      DyadErrorKind.External,
    );
  if (subscriptionAuto) {
    if (account.error) throw new DyadError(account.error, DyadErrorKind.Auth);
    const name = getSubscriptionDefaultModel(
      account.models,
      "planType" in account ? account.planType : undefined,
      settings.selectedModel ?? identity,
    );
    if (!name)
      throw new DyadError(
        "Subscription model availability is unavailable. Try again or disconnect ChatGPT to use your API keys.",
        DyadErrorKind.External,
      );
    return {
      ...(await resolveModelSelection({
        model: { provider: "openai", name },
        preferredEffortLevel: identity.effortLevel,
      })),
      connection: "subscription",
    };
  }
  if (!usesChatGPTSubscription(model, settings, account)) return fallback;
  if (account.error) throw new DyadError(account.error, DyadErrorKind.Auth);
  return { ...identity, connection: "subscription" };
}
