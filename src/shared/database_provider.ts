export type DatabaseProvider = "supabase" | "neon";

export function resolveLinkedDatabaseProvider({
  hasSupabaseProject,
  hasNeonProject,
}: {
  hasSupabaseProject: boolean;
  hasNeonProject: boolean;
}): DatabaseProvider | undefined {
  if (hasNeonProject) return "neon";
  if (hasSupabaseProject) return "supabase";
  return undefined;
}

export type DatabasePromptState =
  | "supabase"
  | "supabase-disconnected"
  | "neon"
  | "neon-disconnected"
  | "none";

export function resolveRootDatabasePromptState({
  hasSupabaseProject,
  supabaseCredentialsAvailable,
  hasNeonProject,
  neonCredentialsAvailable,
}: {
  hasSupabaseProject: boolean;
  supabaseCredentialsAvailable: boolean;
  hasNeonProject: boolean;
  neonCredentialsAvailable: boolean;
}): DatabasePromptState {
  const provider = resolveLinkedDatabaseProvider({
    hasSupabaseProject,
    hasNeonProject,
  });
  if (provider === "neon") {
    return neonCredentialsAvailable ? "neon" : "neon-disconnected";
  }
  if (provider === "supabase") {
    return supabaseCredentialsAvailable ? "supabase" : "supabase-disconnected";
  }
  return "none";
}
