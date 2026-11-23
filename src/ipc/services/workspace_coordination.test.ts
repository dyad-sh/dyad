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
      let drainSettled = false;
      const drained = deletion.drain().then(() => {
        drainSettled = true;
        return finished;
      });
      await settle();
      expect(drainSettled).toBe(false);
      finish.resolve();
      await merge;
      await expect(drained).resolves.toBe(true);
    } finally {
      deletion.release();
    }
  });

  it("releases app-wide and workspace claims from a workspace-scoped operation", async () => {
    const appId = 4243;
    const workspaceKey = workspaceRuntimeId(8);
    const acquired = deferred();
    const release = deferred();
    const finish = deferred();
    const operation = runWorkspaceScopedOperation(
      {
        appId,
        workspaceKey,
        operation: "prepare then deploy",
        appResources: ["app-path"],
        workspaceResources: ["repository"],
      },
      async (context) => {
        acquired.resolve();
        await release.promise;
        context.releaseResources(["app-path", "repository"]);
        await finish.promise;
      },
    );
    await acquired.promise;

    const ran: string[] = [];
    const rename = appOperationCoordinator.run(
      { appId, operation: "rename app", resources: ["app-path"] },
      async () => {
        ran.push("rename");
        return "renamed";
      },
    );
    const commit = appOperationCoordinator.run(
      {
        appId: workspaceKey,
        operation: "commit in workspace",
        resources: ["repository"],
      },
      async () => {
        ran.push("commit");
        return "committed";
      },
    );
    try {
      // The operation holds the app's claim and the workspace's claim...
      await settle();
      expect(ran).toEqual([]);
      // ...and both are free once released, while it is still running.
      release.resolve();
      await expect(rename).resolves.toBe("renamed");
      await expect(commit).resolves.toBe("committed");
    } finally {
      release.resolve();
      finish.resolve();
      await operation;
    }
  });
});

/** Lets every queued promise callback and timer of this tick run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
