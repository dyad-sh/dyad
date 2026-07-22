import path from "node:path";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { withLock } from "@/ipc/utils/lock_utils";
import type { AgentContext } from "../tools/types";

interface MutationLease {
  threadId: string;
  scope: string[];
}

const leases = new Map<number, MutationLease>();
const finalizingApps = new Set<number>();

export function withMutationAdmission<T>(
  appId: number,
  operation: () => Promise<T>,
): Promise<T> {
  return withLock(`subagent-finalization:${appId}`, operation);
}

export function acquireMutationLease(params: {
  appId: number;
  threadId: string;
  scope: string[];
}): boolean {
  if (finalizingApps.has(params.appId)) return false;
  const current = leases.get(params.appId);
  if (current && current.threadId !== params.threadId) return false;
  leases.set(params.appId, {
    threadId: params.threadId,
    scope: params.scope.map(normalizeMutationScope),
  });
  return true;
}

export function beginAppFinalization(appId: number): boolean {
  if (leases.has(appId) || finalizingApps.has(appId)) return false;
  finalizingApps.add(appId);
  return true;
}

export function endAppFinalization(appId: number): void {
  finalizingApps.delete(appId);
}

export function releaseMutationLease(appId: number, threadId: string): void {
  if (leases.get(appId)?.threadId === threadId) leases.delete(appId);
}

export function hasMutationLease(appId: number): boolean {
  return leases.has(appId);
}

export function assertMutationLease(ctx: AgentContext): void {
  if (finalizingApps.has(ctx.appId)) {
    throw new DyadError(
      "This app is currently being finalized. Wait for deployment and commit to finish before making changes.",
      DyadErrorKind.Conflict,
    );
  }
  const lease = leases.get(ctx.appId);
  if (!lease) {
    if (ctx.subagentPersona === "implementer") {
      throw new DyadError(
        "This Implementer no longer owns the app writer lease.",
        DyadErrorKind.Conflict,
      );
    }
    return;
  }
  if (ctx.subagentThreadId !== lease.threadId) {
    throw new DyadError(
      "Another agent is currently editing this app. Wait for it to finish before making changes.",
      DyadErrorKind.Conflict,
    );
  }
}

export function assertImplementerPathAllowed(
  ctx: AgentContext,
  relativePath: string,
): void {
  if (ctx.subagentPersona !== "implementer") return;
  const normalizedPath = normalizeMutationScope(relativePath);
  const scope = ctx.subagentPathScope ?? [];
  if (
    scope.length === 0 ||
    !scope.some(
      (allowed) =>
        normalizedPath === allowed || normalizedPath.startsWith(`${allowed}/`),
    )
  ) {
    throw new DyadError(
      `Implementer may only edit its assigned paths: ${scope.join(", ") || "none"}`,
      DyadErrorKind.Precondition,
    );
  }
}

export function normalizeMutationScope(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  return normalized.replace(/^\.\//, "").replace(/\/$/, "");
}
