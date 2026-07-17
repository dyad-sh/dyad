import { createUserInputResolver } from "./userInputResolver";
import type { DesignOptionsSelection } from "@/ipc/types/design";

export interface IntegrationResult {
  provider: "supabase" | "neon";
}

/**
 * Design mode's pre-generation choice step: `propose_design_options` blocks
 * here until the user picks a direction/palette/typography/shape/platform in
 * the design panel and hits Continue.
 */
export const designOptionsResolver =
  createUserInputResolver<DesignOptionsSelection>({
    timeoutMs: 30 * 60 * 1000,
  });

export const questionnaireResolver = createUserInputResolver<
  Record<string, string>
>({
  timeoutMs: 5 * 60 * 1000,
});

export const integrationResolver = createUserInputResolver<IntegrationResult>({
  timeoutMs: 30 * 60 * 1000,
});
