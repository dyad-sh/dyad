import { describe, expect, it } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { workspaceRuntimeId } from "../../../shared/workspace_runtime_id";
import { appOperationCoordinator } from "./app_operation_coordinator";
import { runWorkspaceScopedOperation } from "./workspace_coordination";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("runWorkspaceScopedOperation", () => {
  it("keeps workspace-only work inside the app deletion fence", async () => {
    const appId = 4242;
    const request = {
      appId,
      workspaceKey: workspaceRuntimeId(7),
      operation: "merge target branch into chat workspace",
      appResources: [],
      workspaceResources: ["repository" as const],
    };
    const started = deferred();
    const finish = deferred();
    let finished = false;
    const merge = runWorkspaceScopedOperation(request, async () => {
      started.resolve();
      await finish.promise;
      finished = true;
    });
    await started.promise;

    const deletion = appOperationCoordinator.beginAppDeletion(appId);
    try {
      // Deletion admits no new workspace work for the app...
      await expect(
        runWorkspaceScopedOperation(request, async () => undefined),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
      // ...and waits for what was already admitted before removing anything.
      const drained = deletion.drain().then(() => finished);
      finish.resolve();
      await merge;
      await expect(drained).resolves.toBe(true);
    } finally {
      deletion.release();
    }
  });
});
