import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { getDyadAppPath } from "@/paths/paths";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  appOperationCoordinator,
  readAppResource,
} from "@/ipc/services/app_operation_coordinator";
import type { AgentContext } from "./types";

const REFERENCED_READ_TOOLS = new Set([
  "read_file",
  "list_files",
  "grep",
  "code_search",
  "explore_code",
]);

/** No current-app claim is held here. Claim only the inspected app, after consent,
 * then refresh its identity/path. Never keep path locks across a human wait. */
export async function withReferencedAppRead<T>(
  name: string,
  args: { app_name?: string },
  ctx: AgentContext,
  invoke: (ctx: AgentContext) => Promise<T>,
): Promise<T> {
  const key = args.app_name?.toLowerCase();
  if (!key || !REFERENCED_READ_TOOLS.has(name)) return invoke(ctx);
  const appId = ctx.referencedAppIds?.get(key);
  if (appId === undefined) {
    // Legacy contexts may contain names/paths but cannot safely bind identity.
    throw new DyadError(
      "Referenced app identity is unavailable. Start a new turn to refresh references.",
      DyadErrorKind.Precondition,
    );
  }
  return appOperationCoordinator.run(
    {
      appId,
      operation: "read referenced app",
      resources: [readAppResource("app-path")],
    },
    async () => {
      ctx.abortSignal?.throwIfAborted();
      const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
      if (!app)
        throw new DyadError(
          "Referenced app no longer exists",
          DyadErrorKind.NotFound,
        );
      ctx.abortSignal?.throwIfAborted();
      const references = new Map(ctx.referencedApps);
      references.set(key, getDyadAppPath(app.path));
      return invoke({ ...ctx, referencedApps: references });
    },
  );
}
