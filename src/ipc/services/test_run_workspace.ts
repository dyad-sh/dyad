import { promises as fs } from "node:fs";
import { getDyadAppPath } from "@/paths/paths";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

/**
 * Main-only source supplied by an agent turn that owns this chat workspace.
 * The turn must retain ownership until its queued run and cleanup settle.
 * Panel requests omit it and continue to test the app's original directory.
 */
export interface TestRunSourceWorkspace {
  appPath: string;
  workspaceId: number;
}

export const WORKTREE_TEST_SANDBOX_REQUIRED =
  "Testing this chat's worktree requires host runtime with isolated test servers enabled in Settings. Enable them and run the tests again. Nothing ran.";

/** Never fall back to the main app if the requested worktree disappeared. */
export async function resolveTestRunAppPath(
  storedAppPath: string,
  sourceWorkspace?: TestRunSourceWorkspace,
): Promise<string> {
  return fs
    .realpath(sourceWorkspace?.appPath ?? getDyadAppPath(storedAppPath))
    .catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
        throw new DyadError(
          sourceWorkspace
            ? "This chat's worktree folder no longer exists. Start a new turn before running its tests again."
            : "The app folder no longer exists. Restore the folder or import the app again before running tests.",
          DyadErrorKind.NotFound,
          { cause: error },
        );
      throw error;
    });
}
