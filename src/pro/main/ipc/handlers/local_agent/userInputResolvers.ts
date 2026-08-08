import { createUserInputResolver } from "./userInputResolver";

export interface IntegrationResult {
  provider: "supabase" | "neon";
}

export const questionnaireResolver = createUserInputResolver<
  Record<string, string>
>({
  timeoutMs: 5 * 60 * 1000,
});

export const integrationResolver = createUserInputResolver<IntegrationResult>({
  timeoutMs: 30 * 60 * 1000,
});
