import type { LanguageModel } from "@/ipc/types";
import type { ClaudeCodeModel } from "@/shared/claude_code_models";

/** Convert known public catalog IDs, never custom deployments or family aliases. */
export function claudeCodeModelId(
  provider: string,
  model: LanguageModel,
): string | undefined {
  if (model.type === "custom") return undefined;
  if (provider === "claude-code") return model.apiName;
  if (
    provider === "anthropic" &&
    /^claude-[a-z0-9-]+(?:\[1m\])?$/.test(model.apiName)
  )
    return model.apiName;
  if (
    provider === "openrouter" &&
    /^anthropic\/claude-[a-z0-9.-]+$/.test(model.apiName)
  )
    return model.apiName.slice("anthropic/".length).replace(/\./g, "-");
  return undefined;
}

export function claudeCodeModelIdentity(
  value: string,
  models: ClaudeCodeModel[],
): string {
  // Context modifiers do not change model version; preserve dated snapshot IDs.
  return (
    models.find((model) => model.value === value)?.resolvedModel ?? value
  ).replace(/\[1m\]$/, "");
}

/** CLI suggestions supplement the catalog, rather than limiting supported IDs. */
export function withClaudeCodeModels(
  catalog: Record<string, LanguageModel[]> | undefined,
  suggestions: ClaudeCodeModel[],
): Record<string, LanguageModel[]> {
  const result: Record<string, LanguageModel[]> = {};
  const claude: LanguageModel[] = [];
  const seen = new Set<string>();
  // Prefer Anthropic metadata when the same model also appears through a reseller.
  const entries = Object.entries(catalog ?? {}).sort(
    ([a], [b]) => Number(b === "anthropic") - Number(a === "anthropic"),
  );
  for (const [provider, models] of entries) {
    // Public Claude models share one row, routed through the connected CLI.
    // Keep custom deployments and provider-specific IDs on their API routes.
    result[provider] = models.filter(
      (model) => !claudeCodeModelId(provider, model),
    );
    for (const model of models) {
      const id = claudeCodeModelId(provider, model);
      if (!id) continue;
      const identity = claudeCodeModelIdentity(id, suggestions);
      if (!seen.has(identity)) {
        seen.add(identity);
        claude.push({ ...model, apiName: id });
      }
    }
  }
  // Prefer concrete entries over Default when they resolve to the same model.
  for (const model of [...suggestions].sort(
    (a, b) => Number(a.value === "default") - Number(b.value === "default"),
  )) {
    const identity = claudeCodeModelIdentity(model.value, suggestions);
    if (seen.has(identity)) continue;
    seen.add(identity);
    claude.push({
      apiName: model.value,
      displayName: model.displayName,
      description: model.description,
      type: "cloud",
    });
  }
  result["claude-code"] = claude;
  return result;
}

export function claudeCodeDisplayName(
  value: string,
  suggestions: ClaudeCodeModel[],
  catalog: Record<string, LanguageModel[]> | undefined,
): string {
  const identity = claudeCodeModelIdentity(value, suggestions);
  const suggested =
    suggestions.find((model) => model.value === value) ??
    suggestions.find(
      (model) =>
        model.value !== "default" &&
        claudeCodeModelIdentity(model.value, suggestions) === identity,
    );
  if (suggested) return suggested.displayName;
  for (const [provider, models] of Object.entries(catalog ?? {})) {
    const match = models.find((model) => {
      const id = claudeCodeModelId(provider, model);
      return id && claudeCodeModelIdentity(id, suggestions) === identity;
    });
    if (match) return match.displayName.replace(/^Claude\s+/, "");
  }
  return value;
}
