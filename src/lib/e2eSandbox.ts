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
