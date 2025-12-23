/**
 * Builds a unique account key for Supabase credentials lookup.
 * Each Supabase OAuth token is scoped to a <userId, organizationId> pair.
 */
export function buildSupabaseAccountKey(
  userId: string,
  organizationId: string,
): string {
  return `${userId}:${organizationId}`;
}

/**
 * Parses an account key back into userId and organizationId.
 */
export function parseSupabaseAccountKey(key: string): {
  userId: string;
  organizationId: string;
} {
  const [userId, organizationId] = key.split(":");
  return { userId, organizationId };
}
