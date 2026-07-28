/**
 * Decides whether Coolify should host a database for an app.
 *
 * An app on portable Postgres wants one. A Supabase app already has a cloud
 * backend and should keep using it. An app with no database configured needs
 * nothing. Asking the user instead offered an option whose "no" left the app
 * deployed without a DATABASE_URL, which only fails once it reads data.
 *
 * Shared so the deploy and the text describing it cannot disagree.
 */
export function shouldProvisionDatabase(app: {
  portableCodegen?: boolean | null;
  supabaseProjectId?: string | null;
}): boolean {
  if (app.supabaseProjectId) return false;
  return Boolean(app.portableCodegen);
}
