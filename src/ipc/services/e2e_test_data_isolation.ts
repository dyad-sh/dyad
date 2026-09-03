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
  signal,
}: {
  app: AppRow;
  workspacePath: string;
  emit: (chunk: string, phase: "setup" | "running") => void;
  signal?: AbortSignal;
}): Promise<PreparedIsolation> {
  return prepareIsolatedTestDatabase({
    app,
    emit,
    runtimeMode: "host",
    signal,
    appPathOverride: workspacePath,
    restartApp: false,
  });
}
