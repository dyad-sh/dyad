import type { ModelSelection, UserSettings } from "@/lib/schemas";
import { resolveBuiltinModelAlias } from "../shared/remote_language_model_catalog";
import { resolveModelSelection } from "../utils/model_effort";
import { resolveSubscriptionModel } from "./resolve_subscription_model";

export const AUTO_DYAD_PRO_MODEL_ALIASES = [
  "dyad/auto/openai",
  "dyad/auto/anthropic",
  "dyad/auto/google",
] as const;
export const AUTO_BALANCED_ALIAS = "dyad/auto/balanced";

export type ResolvedAliasModel = NonNullable<
  Awaited<ReturnType<typeof resolveBuiltinModelAlias>>
>;
export type AutoModelCandidates = Map<
  string,
  { resolvedModel: ResolvedAliasModel; selection: ModelSelection } | null
>;

/** A turn-local snapshot, including unavailable aliases, reused after admission. */
export async function resolveAutoModelCandidate(
  alias: string,
  settings: UserSettings,
  candidates?: AutoModelCandidates,
) {
  if (candidates?.has(alias)) return candidates.get(alias)!;
  const resolvedModel = await resolveBuiltinModelAlias(alias);
  if (
    !resolvedModel ||
    (alias !== AUTO_BALANCED_ALIAS && resolvedModel.apiName.endsWith(":free"))
  )
    return null;
  const selection = await resolveSubscriptionModel(
    await resolveModelSelection({
      model: {
        provider: resolvedModel.providerId,
        name: resolvedModel.apiName,
      },
    }),
    settings,
  );
  return { resolvedModel, selection };
}
