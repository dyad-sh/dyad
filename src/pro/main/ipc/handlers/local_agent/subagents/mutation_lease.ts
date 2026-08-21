import path from "node:path";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { withLock } from "@/ipc/utils/lock_utils";
import type { AgentContext } from "../tools/types";

interface MutationLease {
  threadId: string;
  scope: string[];
}

interface ActiveMutationTool {
  token: symbol;
  quarantined: boolean;
  drainWaiters: Set<() => void>;
}

const leases = new Map<number, MutationLease>();
const finalizingApps = new Set<number>();
const activeMutationTools = new Map<number, ActiveMutationTool>();
const quarantineListeners = new Map<number, Set<() => void>>();
const TOOL_FINALIZATION_WAIT_MS = 10 * 60 * 1000;

export function withMutationAdmission<T>(
  appId: number,
  operation: () => Promise<T>,
): Promise<T> {
  return withLock(`subagent-finalization:${appId}`, operation);
}

export function withMutationAdmissionUntil<T>(params: {
  appId: number;
  abortSignal?: AbortSignal;
  deadlineAt: number;
  operation: () => Promise<T>;
}): Promise<T> {
  if (isMutationQuarantined(params.appId)) {
    return Promise.reject(quarantinedMutationError());
  }
  if (params.abortSignal?.aborted) {
    return Promise.reject(cancelledAdmissionError());
  }
  if (Date.now() >= params.deadlineAt) {
    return Promise.reject(timedOutAdmissionError());
  }

  return new Promise<T>((resolve, reject) => {
    let waiting = true;
    const listeners = quarantineListeners.get(params.appId) ?? new Set();
    quarantineListeners.set(params.appId, listeners);

    const cleanup = () => {
      params.abortSignal?.removeEventListener("abort", onAbort);
      clearTimeout(timeout);
      listeners.delete(onQuarantine);
      if (listeners.size === 0) quarantineListeners.delete(params.appId);
    };
    const stopWaiting = (error: DyadError) => {
      if (!waiting) return;
      waiting = false;
      cleanup();
      reject(error);
    };
    const onAbort = () => stopWaiting(cancelledAdmissionError());
    const onQuarantine = () => stopWaiting(quarantinedMutationError());
    const timeout = setTimeout(
      () => stopWaiting(timedOutAdmissionError()),
      Math.max(0, params.deadlineAt - Date.now()),
    );
    params.abortSignal?.addEventListener("abort", onAbort, { once: true });
    listeners.add(onQuarantine);

    void withMutationAdmission(params.appId, async () => {
      if (!waiting) return;
      waiting = false;
      cleanup();
      try {
        resolve(await params.operation());
      } catch (error) {
        reject(error);
      }
    }).catch((error) => {
      if (!waiting) return;
      waiting = false;
      cleanup();
      reject(error);
    });
  });
}

export async function withMutationToolAdmission<T>(
  ctx: AgentContext,
  operation: () => Promise<T>,
): Promise<T> {
  const deadlineAt = Date.now() + TOOL_FINALIZATION_WAIT_MS;
  while (true) {
    const result = await withMutationAdmissionUntil({
      appId: ctx.appId,
      abortSignal: ctx.abortSignal,
      deadlineAt,
      operation: async () => {
        if (finalizingApps.has(ctx.appId)) {
          return { waiting: true as const };
        }
        assertMutationLease(ctx);
        const active = beginActiveMutationTool(ctx.appId);
        try {
          return { waiting: false as const, value: await operation() };
        } finally {
          finishActiveMutationTool(ctx.appId, active);
        }
      },
    });
    if (!result.waiting) return result.value;
    if (ctx.abortSignal?.aborted) throw cancelledAdmissionError();
    if (Date.now() >= deadlineAt) throw timedOutAdmissionError();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function beginActiveMutationTool(appId: number): ActiveMutationTool {
  if (activeMutationTools.has(appId)) {
    throw new DyadError(
      "Another mutation tool unexpectedly entered app admission.",
      DyadErrorKind.Conflict,
    );
  }
  const active: ActiveMutationTool = {
    token: Symbol("mutation-tool"),
    quarantined: false,
    drainWaiters: new Set(),
  };
  activeMutationTools.set(appId, active);
  return active;
}

function finishActiveMutationTool(
  appId: number,
  active: ActiveMutationTool,
): void {
  if (activeMutationTools.get(appId)?.token !== active.token) return;
  activeMutationTools.delete(appId);
  for (const waiter of active.drainWaiters) waiter();
  active.drainWaiters.clear();
}

export function quarantineActiveMutationTool(appId: number): boolean {
  const active = activeMutationTools.get(appId);
  if (!active) return false;
  if (!active.quarantined) {
    active.quarantined = true;
    for (const listener of quarantineListeners.get(appId) ?? []) listener();
  }
  return true;
}

export function isMutationQuarantined(appId: number): boolean {
  return activeMutationTools.get(appId)?.quarantined === true;
}

export function hasActiveMutationTool(appId: number): boolean {
  return activeMutationTools.has(appId);
}

export function waitForMutationToolDrain(
  appId: number,
  timeoutMs: number,
): Promise<boolean> {
  const active = activeMutationTools.get(appId);
  if (!active) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (didDrain: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      active.drainWaiters.delete(onDrain);
      resolve(didDrain);
    };
    const onDrain = () => finish(true);
    const timeout = setTimeout(() => finish(false), timeoutMs);
    active.drainWaiters.add(onDrain);
    if (activeMutationTools.get(appId)?.token !== active.token) finish(true);
  });
}

function quarantinedMutationError(): DyadError {
  return new DyadError(
    "A cancelled mutation tool is still active for this app.",
    DyadErrorKind.Conflict,
  );
}

function cancelledAdmissionError(): DyadError {
  return new DyadError(
    "Waiting to modify the app was cancelled.",
    DyadErrorKind.UserCancelled,
  );
}

function timedOutAdmissionError(): DyadError {
  return new DyadError(
    "Timed out waiting to modify the app.",
    DyadErrorKind.Conflict,
  );
}

export function acquireMutationLease(params: {
  appId: number;
  threadId: string;
  scope: string[];
}): boolean {
  if (finalizingApps.has(params.appId) || isMutationQuarantined(params.appId)) {
    return false;
  }
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
  if (
    leases.has(appId) ||
    activeMutationTools.has(appId) ||
    finalizingApps.has(appId)
  ) {
    return false;
  }
  finalizingApps.add(appId);
  return true;
}

export function endAppFinalization(appId: number): void {
  finalizingApps.delete(appId);
}

export function releaseMutationLease(appId: number, threadId: string): void {
  if (leases.get(appId)?.threadId === threadId) leases.delete(appId);
}

/** Human-readable account of what is blocking finalization for this app. */
export function describeMutationBlock(appId: number): string | null {
  const activeMutation = activeMutationTools.get(appId);
  if (activeMutation) {
    return activeMutation.quarantined
      ? "A cancelled mutation tool is still active for this app."
      : "A mutation tool is still active for this app.";
  }
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

export function normalizeMutationScope(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  const relative = normalized.replace(/^\.\//, "").replace(/\/$/, "");
  return relative === "." ? "" : relative;
}
