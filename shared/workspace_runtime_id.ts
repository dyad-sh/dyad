/**
 * Isolated chat workspaces run their own preview, logs, and coordination
 * under a numeric "runtime id" so the existing app-id-keyed runtime machinery
 * (app_run actor, log store, process registry, operation coordinator) can host
 * one runtime per workspace without a second keying scheme.
 *
 * Real app ids are small autoincrement integers; workspace runtime ids live in
 * a reserved range above them. Because every workspace id is greater than
 * every app id, operations that hold both an app claim and a workspace claim
 * acquire them in the coordinator's required ascending-id order.
 *
 * Safe to import from both the main and renderer processes.
 */
export const WORKSPACE_RUNTIME_ID_BASE = 1_000_000_000;

export function workspaceRuntimeId(workspaceId: number): number {
  return WORKSPACE_RUNTIME_ID_BASE + workspaceId;
}

export function isWorkspaceRuntimeId(id: number): boolean {
  return Number.isInteger(id) && id > WORKSPACE_RUNTIME_ID_BASE;
}

export function workspaceIdFromRuntimeId(id: number): number | null {
  return isWorkspaceRuntimeId(id) ? id - WORKSPACE_RUNTIME_ID_BASE : null;
}
