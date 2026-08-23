import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadAppPath } from "@/paths/paths";
import { appOperationCoordinator } from "@/ipc/services/app_operation_coordinator";
import {
  getTempPreviewStatus,
  publishTempPreview,
  revokeTempPreview,
} from "@/ipc/services/temp_preview_service";
import { tempPreviewContracts } from "@/ipc/types/temp_preview";
import { createTypedHandler } from "./base";

async function getApp(appId: number) {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) {
    throw new DyadError(
      `App with id ${appId} not found`,
      DyadErrorKind.NotFound,
    );
  }
  return app;
}

export function registerTempPreviewHandlers(): void {
  createTypedHandler(tempPreviewContracts.getStatus, async (_, { appId }) => {
    await getApp(appId);
    return getTempPreviewStatus(appId);
  });

  createTypedHandler(tempPreviewContracts.publish, async (_, { appId }) => {
    return appOperationCoordinator.run(
      {
        appId,
        operation: "publish temporary preview",
        resources: [
          { resource: "app-path", mode: "read" },
          { resource: "runtime-config", mode: "read" },
          { resource: "repository-worktree", mode: "write" },
          "provider",
        ],
        refuseWhenRecording: "publish a temporary preview",
      },
      async () => {
        const app = await getApp(appId);
        return publishTempPreview({
          appId,
          appPath: getDyadAppPath(app.path),
          appName: app.name,
        });
      },
    );
  });

  createTypedHandler(tempPreviewContracts.revoke, async (_, { appId }) => {
    return appOperationCoordinator.run(
      {
        appId,
        operation: "revoke temporary preview",
        resources: ["provider"],
        refuseWhenRecording: "revoke a temporary preview",
      },
      async () => {
        await getApp(appId);
        return revokeTempPreview(appId);
      },
    );
  });
}
