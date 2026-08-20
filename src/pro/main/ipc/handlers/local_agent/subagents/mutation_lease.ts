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
const TOOL_FINALIZATION_WAIT_MS = 10 * 60 * 1000;

export function withMutationAdmission<T>(
  appId: number,
  operation: () => Promise<T>,
): Promise<T> {
  return withLock(`subagent-finalization:${appId}`, operation);
}

export async function withMutationToolAdmission<T>(
  ctx: AgentContext,
  operation: () => Promise<T>,
): Promise<T> {
  const deadlineAt = Date.now() + TOOL_FINALIZATION_WAIT_MS;
  while (true) {
    const result = await withMutationAdmission(ctx.appId, async () => {
      if (finalizingApps.has(ctx.appId)) {
        return { waiting: true as const };
      }
      assertMutationLease(ctx);
      return { waiting: false as const, value: await operation() };
    });
    if (!result.waiting) return result.value;
    if (ctx.abortSignal?.aborted) {
      throw new DyadError(
        "Waiting to modify the app was cancelled.",
        DyadErrorKind.UserCancelled,
      );
    }
    if (Date.now() >= deadlineAt) {
      throw new DyadError(
        "Timed out waiting for the app to finish finalizing.",
        DyadErrorKind.Conflict,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

export function acquireMutationLease(params: {
  appId: number;
  threadId: string;
  scope: string[];
}): boolean {
  if (finalizingApps.has(params.appId)) return false;
  const normalizedScope = params.scope.map(normalizeMutationScope);
  if (
    normalizedScope.some(
      (scope) =>
        scope === "" ||
        scope === ".." ||
        scope.startsWith("../") ||
        path.posix.isAbsolute(scope),
    )
  ) {
    throw new DyadError(
      "Implementer scope must contain explicit relative paths within the app.",
      DyadErrorKind.Validation,
    );
  }
  const current = leases.get(params.appId);
  if (current && current.threadId !== params.threadId) return false;
  leases.set(params.appId, {
    threadId: params.threadId,
    scope: normalizedScope,
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

/**
 * Human-readable account of what is blocking finalization for this app, or
 * null when nothing is. Diagnostic only — a held lease is otherwise invisible,
 * and "Another app operation may still be active" once cost a full forensic
 * pass to attribute to a hung Implementer's orphaned lease.
 */
export function describeMutationBlock(appId: number): string | null {
  const lease = leases.get(appId);
  if (lease) {
    return `The app writer lease is still held by sub-agent thread ${lease.threadId} (scope: ${
      lease.scope.join(", ") || "none"
    }).`;
  }
  if (finalizingApps.has(appId)) {
    return "Another finalization for this app is still in progress.";
  }
  return null;
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
  const relative = normalized.replace(/^\.\//, "").replace(/\/$/, "");
  return relative === "." ? "" : relative;
}
