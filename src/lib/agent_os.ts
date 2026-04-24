/**
 * Agent OS — Tier 1 (OS Shell) Engine
 *
 * Pure TypeScript service module (no Electron / no IPC).
 * Provides:
 *   - A registry of commands (built-in + dynamically registered)
 *   - An intent surface (fire intent → match → dispatch → record result)
 *   - A "what's running" activity registry that other subsystems write into
 *
 * IPC handlers in `src/ipc/handlers/agent_os_handlers.ts` are thin wrappers.
 */

import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import log from "electron-log";

import { db } from "@/db";
import {
  osActivities,
  osCommands,
  osIntents,
  type OsActivityRow,
  type OsActivityStatus,
  type OsActivitySource,
  type OsCommandRow,
  type OsCommandScope,
  type OsIntentRow,
  type OsIntentStatus,
} from "@/db/agent_os_schema";

const logger = log.scope("agent_os");

// =============================================================================
// IN-MEMORY HANDLER REGISTRY
//
// Commands can dispatch to either:
//   - an IPC channel (handled in renderer or main),
//   - or an in-memory handler key registered here at runtime.
// =============================================================================

export type IntentDispatchHandler = (
  command: OsCommandRow,
  input: Record<string, unknown> | null,
  intent: OsIntentRow,
) => Promise<unknown>;

const handlers = new Map<string, IntentDispatchHandler>();

export function registerIntentHandler(
  handlerKey: string,
  handler: IntentDispatchHandler,
): void {
  handlers.set(handlerKey, handler);
}

export function unregisterIntentHandler(handlerKey: string): void {
  handlers.delete(handlerKey);
}

// =============================================================================
// HELPERS
// =============================================================================

function uuid(): string {
  return randomUUID();
}

function now(): Date {
  return new Date();
}

// =============================================================================
// COMMAND REGISTRY
// =============================================================================

export interface RegisterCommandInput {
  id: string;
  title: string;
  description?: string;
  scope?: OsCommandScope;
  capability?: string;
  keywords?: string[];
  ipcChannel?: string;
  handlerKey?: string;
  requiresInput?: boolean;
  inputSchemaJson?: Record<string, unknown> | null;
  enabled?: boolean;
  icon?: string;
}

export async function registerCommand(
  input: RegisterCommandInput,
): Promise<OsCommandRow> {
  if (!input.id) throw new Error("registerCommand: id is required");
  if (!input.title) throw new Error("registerCommand: title is required");
  if (!input.ipcChannel && !input.handlerKey) {
    throw new Error(
      "registerCommand: must specify either ipcChannel or handlerKey",
    );
  }

  const ts = now();
  const existing = await db
    .select()
    .from(osCommands)
    .where(eq(osCommands.id, input.id))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(osCommands)
      .set({
        title: input.title,
        description: input.description ?? null,
        scope: input.scope ?? "system",
        capability: input.capability ?? null,
        keywords: input.keywords ?? null,
        ipcChannel: input.ipcChannel ?? null,
        handlerKey: input.handlerKey ?? null,
        requiresInput: input.requiresInput ?? false,
        inputSchemaJson: input.inputSchemaJson ?? null,
        enabled: input.enabled ?? true,
        icon: input.icon ?? null,
        updatedAt: ts,
      })
      .where(eq(osCommands.id, input.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(osCommands)
    .values({
      id: input.id,
      title: input.title,
      description: input.description ?? null,
      scope: input.scope ?? "system",
      capability: input.capability ?? null,
      keywords: input.keywords ?? null,
      ipcChannel: input.ipcChannel ?? null,
      handlerKey: input.handlerKey ?? null,
      requiresInput: input.requiresInput ?? false,
      inputSchemaJson: input.inputSchemaJson ?? null,
      enabled: input.enabled ?? true,
      icon: input.icon ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    .returning();
  return created;
}

export async function unregisterCommand(id: string): Promise<void> {
  await db.delete(osCommands).where(eq(osCommands.id, id));
}

export interface CommandFilters {
  scope?: OsCommandScope;
  enabledOnly?: boolean;
}

export async function listCommands(
  filters: CommandFilters = {},
): Promise<OsCommandRow[]> {
  const conds = [];
  if (filters.scope) conds.push(eq(osCommands.scope, filters.scope));
  if (filters.enabledOnly) conds.push(eq(osCommands.enabled, true));
  const where = conds.length > 0 ? and(...conds) : undefined;
  return where
    ? await db.select().from(osCommands).where(where)
    : await db.select().from(osCommands);
}

export async function getCommand(id: string): Promise<OsCommandRow | null> {
  const rows = await db
    .select()
    .from(osCommands)
    .where(eq(osCommands.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Search commands by title / description / keyword fragment.
 * Returns commands ranked by a tiny relevance heuristic (exact id > title
 * prefix > title contains > keyword contains > description contains).
 */
export async function searchCommands(
  query: string,
  scope?: OsCommandScope,
): Promise<OsCommandRow[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const like_ = `%${trimmed.toLowerCase()}%`;

  const baseConds = [eq(osCommands.enabled, true)];
  if (scope) baseConds.push(eq(osCommands.scope, scope));

  const matches = await db
    .select()
    .from(osCommands)
    .where(
      and(
        ...baseConds,
        or(
          like(osCommands.id, like_),
          like(osCommands.title, like_),
          like(osCommands.description, like_),
        ) ?? eq(osCommands.enabled, true),
      ),
    );

  // Rank
  const q = trimmed.toLowerCase();
  return matches
    .map((c) => {
      const title = (c.title ?? "").toLowerCase();
      const id = (c.id ?? "").toLowerCase();
      const desc = (c.description ?? "").toLowerCase();
      const kws = Array.isArray(c.keywords) ? c.keywords : [];
      let score = 0;
      if (id === q) score += 100;
      if (title === q) score += 90;
      if (title.startsWith(q)) score += 60;
      if (title.includes(q)) score += 40;
      if (kws.some((k) => k.toLowerCase().includes(q))) score += 30;
      if (desc.includes(q)) score += 10;
      return { c, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.c);
}

// =============================================================================
// INTENT SURFACE
// =============================================================================

export interface FireIntentInput {
  query: string;
  scope?: OsCommandScope;
  input?: Record<string, unknown> | null;
  requestedBy?: string;
  /** If you already know the command, set it directly to skip the matcher. */
  matchedCommandId?: string;
}

export async function fireIntent(input: FireIntentInput): Promise<OsIntentRow> {
  if (!input.query?.trim() && !input.matchedCommandId) {
    throw new Error("fireIntent: query or matchedCommandId is required");
  }

  const id = uuid();
  const ts = now();

  let matchedCommandId = input.matchedCommandId ?? null;
  let status: OsIntentStatus = "pending";

  if (!matchedCommandId && input.query) {
    const matches = await searchCommands(input.query, input.scope);
    if (matches.length > 0) {
      matchedCommandId = matches[0].id;
      status = "matched";
    }
  } else if (matchedCommandId) {
    status = "matched";
  }

  const [intent] = await db
    .insert(osIntents)
    .values({
      id,
      query: input.query ?? "",
      scope: input.scope ?? null,
      status,
      matchedCommandId,
      inputJson: input.input ?? null,
      requestedBy: input.requestedBy ?? "user",
      createdAt: ts,
    })
    .returning();
  return intent;
}

export async function getIntent(id: string): Promise<OsIntentRow | null> {
  const rows = await db
    .select()
    .from(osIntents)
    .where(eq(osIntents.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export interface IntentFilters {
  status?: OsIntentStatus;
  limit?: number;
}

export async function listIntents(
  filters: IntentFilters = {},
): Promise<OsIntentRow[]> {
  const limit = filters.limit ?? 100;
  const q = filters.status
    ? db
        .select()
        .from(osIntents)
        .where(eq(osIntents.status, filters.status))
    : db.select().from(osIntents);
  return await q.orderBy(desc(osIntents.createdAt)).limit(limit);
}

export async function cancelIntent(id: string): Promise<OsIntentRow> {
  const ts = now();
  const [updated] = await db
    .update(osIntents)
    .set({ status: "cancelled", completedAt: ts })
    .where(eq(osIntents.id, id))
    .returning();
  if (!updated) throw new Error(`cancelIntent: intent not found: ${id}`);
  return updated;
}

/**
 * Dispatch a matched intent to its handler.
 *
 * If the matched command points to an IPC channel, this engine cannot
 * cross the renderer/main boundary on its own — the IPC handler will return
 * `{ kind: "ipc-forward", channel, input }` so the renderer can complete
 * the call. If the command points to a `handlerKey`, this engine runs it
 * inline, records the result, and transitions the intent to `completed`.
 */
export type DispatchOutcome =
  | { kind: "completed"; intent: OsIntentRow; result: unknown }
  | { kind: "ipc-forward"; intent: OsIntentRow; channel: string };

export async function dispatchIntent(intentId: string): Promise<DispatchOutcome> {
  const intent = await getIntent(intentId);
  if (!intent) throw new Error(`dispatchIntent: intent not found: ${intentId}`);
  if (intent.status === "completed" || intent.status === "cancelled") {
    throw new Error(
      `dispatchIntent: intent ${intentId} already in terminal state ${intent.status}`,
    );
  }
  if (!intent.matchedCommandId) {
    throw new Error(
      `dispatchIntent: intent ${intentId} has no matched command`,
    );
  }
  const command = await getCommand(intent.matchedCommandId);
  if (!command) {
    throw new Error(
      `dispatchIntent: command ${intent.matchedCommandId} not found`,
    );
  }
  if (!command.enabled) {
    throw new Error(`dispatchIntent: command ${command.id} is disabled`);
  }

  const ts = now();

  // IPC dispatch: record state, hand off to renderer / main caller.
  if (command.ipcChannel) {
    const [updated] = await db
      .update(osIntents)
      .set({
        status: "dispatched",
        dispatchedTarget: command.ipcChannel,
        dispatchedAt: ts,
      })
      .where(eq(osIntents.id, intentId))
      .returning();
    return { kind: "ipc-forward", intent: updated, channel: command.ipcChannel };
  }

  // In-memory handler dispatch: run inline.
  if (command.handlerKey) {
    const handler = handlers.get(command.handlerKey);
    if (!handler) {
      throw new Error(
        `dispatchIntent: no handler registered for key ${command.handlerKey}`,
      );
    }
    await db
      .update(osIntents)
      .set({
        status: "dispatched",
        dispatchedTarget: command.handlerKey,
        dispatchedAt: ts,
      })
      .where(eq(osIntents.id, intentId));
    try {
      const result = await handler(command, intent.inputJson ?? null, intent);
      const [completed] = await db
        .update(osIntents)
        .set({
          status: "completed",
          resultJson:
            result && typeof result === "object"
              ? (result as Record<string, unknown>)
              : { value: result },
          completedAt: now(),
        })
        .where(eq(osIntents.id, intentId))
        .returning();
      return { kind: "completed", intent: completed, result };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const [failed] = await db
        .update(osIntents)
        .set({
          status: "failed",
          errorMessage: message,
          completedAt: now(),
        })
        .where(eq(osIntents.id, intentId))
        .returning();
      logger.warn("dispatchIntent failed", intentId, message);
      return { kind: "completed", intent: failed, result: { error: message } };
    }
  }

  throw new Error(
    `dispatchIntent: command ${command.id} has neither ipcChannel nor handlerKey`,
  );
}

/**
 * Mark a previously-dispatched intent (typically an IPC-forwarded one)
 * as completed or failed once the caller knows the outcome.
 */
export async function completeIntent(
  intentId: string,
  result: Record<string, unknown> | null,
): Promise<OsIntentRow> {
  const [updated] = await db
    .update(osIntents)
    .set({ status: "completed", resultJson: result, completedAt: now() })
    .where(eq(osIntents.id, intentId))
    .returning();
  if (!updated) throw new Error(`completeIntent: intent not found: ${intentId}`);
  return updated;
}

export async function failIntent(
  intentId: string,
  errorMessage: string,
): Promise<OsIntentRow> {
  const [updated] = await db
    .update(osIntents)
    .set({ status: "failed", errorMessage, completedAt: now() })
    .where(eq(osIntents.id, intentId))
    .returning();
  if (!updated) throw new Error(`failIntent: intent not found: ${intentId}`);
  return updated;
}

// =============================================================================
// "WHAT'S RUNNING" — ACTIVITY REGISTRY
//
// Other subsystems (A2A, missions, chats) write here so the OS shell can
// show a single live feed without coupling.
// =============================================================================

export interface StartActivityInput {
  source: OsActivitySource;
  sourceRef?: string;
  title: string;
  subtitle?: string;
  metadata?: Record<string, unknown> | null;
}

export async function startActivity(
  input: StartActivityInput,
): Promise<OsActivityRow> {
  if (!input.title) throw new Error("startActivity: title is required");
  const id = uuid();
  const ts = now();
  const [row] = await db
    .insert(osActivities)
    .values({
      id,
      source: input.source,
      sourceRef: input.sourceRef ?? null,
      title: input.title,
      subtitle: input.subtitle ?? null,
      status: "running",
      progress: 0,
      metadataJson: input.metadata ?? null,
      startedAt: ts,
      updatedAt: ts,
    })
    .returning();
  return row;
}

export interface UpdateActivityInput {
  progress?: number;
  subtitle?: string;
  metadata?: Record<string, unknown> | null;
  status?: OsActivityStatus;
  errorMessage?: string;
}

export async function updateActivity(
  id: string,
  patch: UpdateActivityInput,
): Promise<OsActivityRow> {
  const updates: Record<string, unknown> = { updatedAt: now() };
  if (patch.progress !== undefined) {
    updates.progress = Math.max(0, Math.min(100, patch.progress));
  }
  if (patch.subtitle !== undefined) updates.subtitle = patch.subtitle;
  if (patch.metadata !== undefined) updates.metadataJson = patch.metadata;
  if (patch.status !== undefined) {
    updates.status = patch.status;
    if (
      patch.status === "completed" ||
      patch.status === "failed" ||
      patch.status === "cancelled"
    ) {
      updates.completedAt = now();
    }
  }
  if (patch.errorMessage !== undefined) updates.errorMessage = patch.errorMessage;

  const [row] = await db
    .update(osActivities)
    .set(updates)
    .where(eq(osActivities.id, id))
    .returning();
  if (!row) throw new Error(`updateActivity: activity not found: ${id}`);
  return row;
}

export async function completeActivity(
  id: string,
  metadata?: Record<string, unknown> | null,
): Promise<OsActivityRow> {
  return updateActivity(id, {
    status: "completed",
    progress: 100,
    metadata: metadata ?? undefined,
  });
}

export async function failActivity(
  id: string,
  errorMessage: string,
): Promise<OsActivityRow> {
  return updateActivity(id, { status: "failed", errorMessage });
}

export async function cancelActivity(id: string): Promise<OsActivityRow> {
  return updateActivity(id, { status: "cancelled" });
}

export interface ActivityFilters {
  status?: OsActivityStatus | OsActivityStatus[];
  source?: OsActivitySource;
  limit?: number;
}

export async function listActivities(
  filters: ActivityFilters = {},
): Promise<OsActivityRow[]> {
  const conds = [];
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      conds.push(inArray(osActivities.status, filters.status));
    } else {
      conds.push(eq(osActivities.status, filters.status));
    }
  }
  if (filters.source) conds.push(eq(osActivities.source, filters.source));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const limit = filters.limit ?? 200;

  const q = where
    ? db.select().from(osActivities).where(where)
    : db.select().from(osActivities);
  return await q.orderBy(desc(osActivities.startedAt)).limit(limit);
}

export async function getActivity(id: string): Promise<OsActivityRow | null> {
  const rows = await db
    .select()
    .from(osActivities)
    .where(eq(osActivities.id, id))
    .limit(1);
  return rows[0] ?? null;
}

// =============================================================================
// BUILT-IN COMMAND SEEDING
//
// Idempotent. Called from the IPC layer at app startup so the palette is
// populated even on a fresh DB.
// =============================================================================

export async function seedBuiltinCommands(): Promise<void> {
  const builtins: RegisterCommandInput[] = [
    {
      id: "a2a.listings.list",
      title: "A2A — Browse marketplace",
      description: "List all active agent service listings",
      scope: "system",
      capability: "a2a.read",
      keywords: ["a2a", "marketplace", "listings", "agents"],
      ipcChannel: "a2a:listing:list",
    },
    {
      id: "a2a.contracts.list",
      title: "A2A — My contracts",
      description: "Show contracts I am party to",
      scope: "system",
      capability: "a2a.read",
      keywords: ["a2a", "contracts", "escrow"],
      ipcChannel: "a2a:contract:list",
    },
    {
      id: "a2a.principal.list",
      title: "A2A — My economic identities",
      description: "Show my agent principals (DIDs and budgets)",
      scope: "system",
      capability: "a2a.read",
      keywords: ["a2a", "principal", "did", "budget", "wallet"],
      ipcChannel: "a2a:principal:list",
    },
    {
      id: "os.activities.running",
      title: "What's running",
      description: "Show all active activities across the OS",
      scope: "system",
      capability: "os.read",
      keywords: ["activities", "running", "tasks", "jobs"],
      ipcChannel: "os:activity:list",
    },
  ];
  for (const b of builtins) {
    try {
      await registerCommand(b);
    } catch (err) {
      logger.warn("seedBuiltinCommands: failed to register", b.id, err);
    }
  }
}

// =============================================================================
// TEST EXPORTS
// =============================================================================

export const __test__ = {
  uuid,
  now,
};
