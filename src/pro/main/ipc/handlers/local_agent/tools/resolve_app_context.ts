import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { AgentContext } from "./types";

/**
 * Resolve the app path a read-only tool should target.
 *
 * - Omitted `appId` → current app (`ctx.appPath`).
 * - Provided `appId` → must match a referenced app from the current turn's
 *   `@app:Name` mentions. Any other value is rejected.
 *
 * Write tools do not call this — they operate only on `ctx.appPath` so that
 * referenced apps remain structurally unreachable for modification.
 */
export function resolveTargetAppPath(
  ctx: AgentContext,
  appId: string | undefined,
): string {
  if (!appId) {
    return ctx.appPath;
  }
  const entry = ctx.referencedApps.get(appId);
  if (entry) {
    return entry.appPath;
  }
  const available = [...ctx.referencedApps.keys()];
  const availableStr =
    available.length > 0 ? available.join(", ") : "(none available)";
  throw new DyadError(
    `Unknown app_id '${appId}'. Available referenced apps: ${availableStr}`,
    DyadErrorKind.NotFound,
  );
}
