import type { UserSettings } from "@/lib/schemas";

/**
 * Whether an E2E test run for this app will execute in an isolated sandbox: a
 * throwaway copy of the app served by its own run-scoped dev server.
 *
 * Shared by the main process (which routes the run) and the renderer/agent
 * (which gate on whether the user's normal preview is required at all). The
 * sandbox is host-only for now, and the user can opt out of it.
 */
export function usesSandboxedE2eTests(
  settings:
    | Pick<UserSettings, "runtimeMode2" | "disableSandboxedE2eTests">
    | null
    | undefined,
): boolean {
  if (!settings) return false;
  return (
    (settings.runtimeMode2 ?? "host") === "host" &&
    !settings.disableSandboxedE2eTests
  );
}

/**
 * Whether a run for this app is refused outright when no sandbox is available.
 *
 * Neon isolation depends on the branch swap only a sandboxed run performs, so
 * without one Dyad refuses rather than pointing Playwright at the user's real
 * database. Supabase takes precedence and is NOT refused: its isolation is an
 * RLS-scoped throwaway test user in the real project, which works with or
 * without a sandbox — so an app row carrying both provider ids still runs.
 *
 * Shared by the main process, which performs the refusal, and the Tests panel,
 * which discloses it before the click. Two copies of this precedence is exactly
 * how the banner and the handler drift into disagreeing.
 */
export function refusesUnsandboxedTestRun(
  app: TestIsolationApp | null | undefined,
): boolean {
  return isNeonOnlyApp(app);
}

type TestIsolationApp = {
  supabaseProjectId?: string | null;
  neonProjectId?: string | null;
};

/**
 * Whether a test run for this app isolates via a temporary Neon branch.
 *
 * The provider precedence `prepareIsolatedTestDatabase` applies, in one place:
 * Supabase first, so an app row carrying both ids takes the test-user path and
 * gets no temporary database. Anything that *describes* what a run will do to
 * the user's data has to ask this rather than test `neonProjectId` alone.
 */
export function isNeonOnlyApp(
  app: TestIsolationApp | null | undefined,
): boolean {
  return Boolean(app && !app.supabaseProjectId && app.neonProjectId);
}
