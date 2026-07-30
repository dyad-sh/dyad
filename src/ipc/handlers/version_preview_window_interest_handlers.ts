import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { windowRegistry } from "@/window_infrastructure/main/window_registry";
import { versionContracts } from "../types/version";
import { versionPreviewActorService } from "../services/version_preview_actor_service";
import { createTypedHandler } from "./base";

export function registerVersionPreviewWindowInterestHandlers(): void {
  // Retained as the protocol-v1/rollback façade for older renderer clients.
  // Current renderers acquire the same RemoteSubscriptionLease ownership via
  // remote-machine intents, so these handlers must not grow separate state.
  createTypedHandler(
    versionContracts.acquirePreviewWindowInterest,
    async (event, { appId }) => {
      if (event.sender.isDestroyed()) return { acquired: false };
      // Register before the asynchronous lookup so destruction during the
      // await removes any existing interest for this window.
      windowRegistry.ensureRegistered(event.sender);
      const app = await db.query.apps.findFirst({
        columns: { id: true },
        where: eq(apps.id, appId),
      });
      if (!app) {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }
      if (event.sender.isDestroyed()) return { acquired: false };
      const windowSessionId = windowRegistry.ensureRegistered(event.sender);
      return {
        acquired: await versionPreviewActorService.acquireWindowInterest(
          appId,
          windowSessionId,
        ),
      };
    },
  );

  createTypedHandler(
    versionContracts.restorePreviewWindowInterest,
    async (event, { appId }) => {
      if (event.sender.isDestroyed()) return { acquired: false };
      windowRegistry.ensureRegistered(event.sender);
      const app = await db.query.apps.findFirst({
        columns: { id: true },
        where: eq(apps.id, appId),
      });
      if (!app) {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }
      if (event.sender.isDestroyed()) return { acquired: false };
      const windowSessionId = windowRegistry.ensureRegistered(event.sender);
      return {
        acquired: await versionPreviewActorService.restoreWindowInterest(
          appId,
          windowSessionId,
        ),
      };
    },
  );

  createTypedHandler(
    versionContracts.releasePreviewWindowInterest,
    async (event, { appId, operationId, exit }) => {
      const windowSessionId = windowRegistry.ensureRegistered(event.sender);
      return {
        cleanupStarted: await versionPreviewActorService.releaseWindowInterest({
          appId,
          windowSessionId,
          operationId,
          exit,
        }),
      };
    },
  );
}
