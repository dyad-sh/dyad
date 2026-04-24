/**
 * Agent OS — Tier 1 IPC Handlers
 *
 * Thin wrappers around `@/lib/agent_os`. All handlers throw on error
 * (per repo convention).
 *
 * Channels (14):
 *   Commands:    os:command:register, os:command:unregister,
 *                os:command:list, os:command:get, os:command:search
 *   Intents:     os:intent:fire, os:intent:dispatch, os:intent:list,
 *                os:intent:get, os:intent:cancel, os:intent:complete
 *   Activities:  os:activity:start, os:activity:update, os:activity:list,
 *                os:activity:get
 *
 * Note: 15 channels including os:bootstrap. Counted only the public surface above.
 */

import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";

import {
  cancelIntent,
  completeIntent,
  dispatchIntent,
  failIntent,
  fireIntent,
  getActivity,
  getCommand,
  getIntent,
  listActivities,
  listCommands,
  listIntents,
  registerCommand,
  searchCommands,
  seedBuiltinCommands,
  startActivity,
  unregisterCommand,
  updateActivity,
  type ActivityFilters,
  type CommandFilters,
  type FireIntentInput,
  type IntentFilters,
  type RegisterCommandInput,
  type StartActivityInput,
  type UpdateActivityInput,
} from "@/lib/agent_os";
import type { OsCommandScope } from "@/db/agent_os_schema";

const logger = log.scope("agent_os_handlers");
const handle = createLoggedHandler(logger);

let didSeed = false;

export function registerAgentOsHandlers(): void {
  // Built-in command seeding — fire-and-forget at startup.
  if (!didSeed) {
    didSeed = true;
    seedBuiltinCommands().catch((err) =>
      logger.warn("seedBuiltinCommands failed", err),
    );
  }

  // ── Commands ──────────────────────────────────────────────────────────────

  handle("os:command:register", async (_e, input: RegisterCommandInput) => {
    if (!input?.id) throw new Error("os:command:register: id required");
    return await registerCommand(input);
  });

  handle("os:command:unregister", async (_e, params: { id: string }) => {
    if (!params?.id) throw new Error("os:command:unregister: id required");
    await unregisterCommand(params.id);
    return { ok: true };
  });

  handle("os:command:list", async (_e, filters?: CommandFilters) => {
    return await listCommands(filters ?? {});
  });

  handle("os:command:get", async (_e, params: { id: string }) => {
    if (!params?.id) throw new Error("os:command:get: id required");
    return await getCommand(params.id);
  });

  handle(
    "os:command:search",
    async (
      _e,
      params: { query: string; scope?: OsCommandScope },
    ) => {
      if (!params?.query) throw new Error("os:command:search: query required");
      return await searchCommands(params.query, params.scope);
    },
  );

  // ── Intents ───────────────────────────────────────────────────────────────

  handle("os:intent:fire", async (_e, input: FireIntentInput) => {
    if (!input?.query && !input?.matchedCommandId) {
      throw new Error("os:intent:fire: query or matchedCommandId required");
    }
    return await fireIntent(input);
  });

  handle("os:intent:dispatch", async (_e, params: { intentId: string }) => {
    if (!params?.intentId) throw new Error("os:intent:dispatch: intentId required");
    return await dispatchIntent(params.intentId);
  });

  handle("os:intent:list", async (_e, filters?: IntentFilters) => {
    return await listIntents(filters ?? {});
  });

  handle("os:intent:get", async (_e, params: { id: string }) => {
    if (!params?.id) throw new Error("os:intent:get: id required");
    return await getIntent(params.id);
  });

  handle("os:intent:cancel", async (_e, params: { id: string }) => {
    if (!params?.id) throw new Error("os:intent:cancel: id required");
    return await cancelIntent(params.id);
  });

  handle(
    "os:intent:complete",
    async (
      _e,
      params: {
        id: string;
        result?: Record<string, unknown> | null;
        errorMessage?: string;
      },
    ) => {
      if (!params?.id) throw new Error("os:intent:complete: id required");
      if (params.errorMessage) {
        return await failIntent(params.id, params.errorMessage);
      }
      return await completeIntent(params.id, params.result ?? null);
    },
  );

  // ── Activities ────────────────────────────────────────────────────────────

  handle("os:activity:start", async (_e, input: StartActivityInput) => {
    if (!input?.title) throw new Error("os:activity:start: title required");
    if (!input?.source) throw new Error("os:activity:start: source required");
    return await startActivity(input);
  });

  handle(
    "os:activity:update",
    async (_e, params: { id: string; patch: UpdateActivityInput }) => {
      if (!params?.id) throw new Error("os:activity:update: id required");
      if (!params?.patch) throw new Error("os:activity:update: patch required");
      return await updateActivity(params.id, params.patch);
    },
  );

  handle("os:activity:list", async (_e, filters?: ActivityFilters) => {
    return await listActivities(filters ?? {});
  });

  handle("os:activity:get", async (_e, params: { id: string }) => {
    if (!params?.id) throw new Error("os:activity:get: id required");
    return await getActivity(params.id);
  });
}
