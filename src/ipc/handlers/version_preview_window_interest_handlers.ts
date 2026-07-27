import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import { versionContracts } from "../types/version";
import { versionPreviewActorService } from "../services/version_preview_actor_service";
import { createTypedHandler } from "./base";

export function registerVersionPreviewWindowInterestHandlers(): void {
  createTypedHandler(
    versionContracts.acquirePreviewWindowInterest,
    async (event, { appId }) => {
      const app = await db.query.apps.findFirst({
        columns: { id: true },
        where: eq(apps.id, appId),
      });
      if (!app) {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }
      windowRegistry.ensureRegistered(event.sender);
      versionPreviewActorService.acquireWindowInterest(appId, event.sender.id);
    },
  );

  createTypedHandler(
    versionContracts.releasePreviewWindowInterest,
    async (event, { appId, operationId, exit }) => {
      const windowSessionId = windowRegistry.ensureRegistered(event.sender);
      return {
        cleanupStarted: versionPreviewActorService.releaseWindowInterest({
          appId,
          webContentsId: event.sender.id,
          windowSessionId,
          operationId,
          exit,
        }),
      };
    },
  );
}
