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

export function resolvePreferredDatabaseProvider({
  hasSupabaseProject,
  supabaseAvailable,
  hasNeonProject,
  neonAvailable,
}: {
  hasSupabaseProject: boolean;
  supabaseAvailable: boolean;
  hasNeonProject: boolean;
  neonAvailable: boolean;
}): DatabaseProvider | undefined {
  if (hasNeonProject && neonAvailable) return "neon";
  if (hasSupabaseProject && supabaseAvailable) return "supabase";
  return resolveLinkedDatabaseProvider({
    hasSupabaseProject,
    hasNeonProject,
  });
}
