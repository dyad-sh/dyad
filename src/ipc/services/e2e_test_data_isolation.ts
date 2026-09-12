import { apps } from "@/db/schema";
import {
  prepareIsolatedTestDatabase,
  type PreparedIsolation,
} from "./isolated_test_db";

type AppRow = typeof apps.$inferSelect;

/**
 * E2E-only adapter for provider isolation. Unlike the recorder-facing default,
 * this writes only inside the disposable workspace and never restarts the
 * normal preview.
 */
export function prepareE2eTestDataIsolation({
  app,
  workspacePath,
  emit,
  runtimeMode,
  signal,
}: {
  app: AppRow;
  workspacePath: string;
  emit: (chunk: string, phase: "setup" | "running") => void;
  /**
   * The caller's real runtime, passed rather than assumed.
   *
   * The Neon branch swap is host-only, and `prepareIsolatedTestDatabase`
   * enforces that itself. Hardcoding "host" here would satisfy that check from
   * the outside on the strength of a non-local invariant — that
   * `usesSandboxedE2eTests` is false off host — so the day the sandbox is
   * extended to Docker or cloud, the env swap and in-place restart would run
   * there silently. The sibling non-sandboxed path passes the real mode for
   * exactly this reason.
   */
  runtimeMode: string;
  signal?: AbortSignal;
}): Promise<PreparedIsolation> {
  return prepareIsolatedTestDatabase({
    app,
    emit,
    runtimeMode,
    signal,
    appPathOverride: workspacePath,
    restartApp: false,
  });
}
