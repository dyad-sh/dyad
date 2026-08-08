export type CompletedIntegrationProvider = "supabase" | "neon" | null;

export function getCompletedIntegrationProvider(
  app:
    | {
        supabaseProjectName?: string | null;
        neonProjectId?: string | null;
      }
    | null
    | undefined,
): CompletedIntegrationProvider {
  if (app?.supabaseProjectName) {
    return "supabase";
  }

  if (app?.neonProjectId) {
    return "neon";
  }

  return null;
}
