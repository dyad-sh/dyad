import path from "node:path";
import { randomUUID } from "node:crypto";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { SubagentPersona } from "@/ipc/types";
import type { AgentContext } from "../tools/types";

export interface MutationActivityOwner {
  appId: number;
  turnId: string;
  chatId: number;
  actorRunId: string;
  threadId?: string;
  persona?: SubagentPersona;
}

export interface ActivityHandle {
  readonly owner: MutationActivityOwner;
  settle(): void;
}

interface ActorRecord {
  owner: MutationActivityOwner;
  open: boolean;
  tokens: Set<symbol>;
  drainWaiters: Set<() => void>;
}

interface TurnRecord {
  appId: number;
  chatId: number;
  phase: "open" | "finalizing";
  actors: Map<string, ActorRecord>;
}

const turns = new Map<string, TurnRecord>();
const actorToTurn = new Map<string, string>();

function getOrCreateActor(owner: MutationActivityOwner): ActorRecord {
  let turn = turns.get(owner.turnId);
  if (!turn) {
    turn = {
      appId: owner.appId,
      chatId: owner.chatId,
      phase: "open",
      actors: new Map(),
    };
    turns.set(owner.turnId, turn);
  }
  if (turn.appId !== owner.appId || turn.chatId !== owner.chatId) {
    throw new DyadError(
      "Mutation owner identity does not match its root turn.",
      DyadErrorKind.Conflict,
    );
  }
  if (turn.phase !== "open") {
    throw new DyadError(
      "This turn is already finalizing and cannot start more work.",
      DyadErrorKind.Conflict,
    );
  }
  let actor = turn.actors.get(owner.actorRunId);
  if (!actor) {
    actor = {
      owner,
      open: true,
      tokens: new Set(),
      drainWaiters: new Set(),
    };
    turn.actors.set(owner.actorRunId, actor);
    actorToTurn.set(owner.actorRunId, owner.turnId);
  } else if (!actor.open) {
    throw new DyadError(
      "This agent execution was stopped and cannot modify the app.",
      DyadErrorKind.UserCancelled,
    );
  }
  return actor;
}

export function createMutationActivityOwner(params: {
  appId: number;
  turnId: string;
  chatId: number;
  actorRunId?: string;
  threadId?: string;
  persona?: SubagentPersona;
}): MutationActivityOwner {
  const owner = {
    ...params,
    actorRunId: params.actorRunId ?? randomUUID(),
  };
  getOrCreateActor(owner);
  return owner;
}

export function reserveMutationActivity(
  owner: MutationActivityOwner,
  label = "mutation",
): ActivityHandle {
  const actor = getOrCreateActor(owner);
  const token = Symbol(label);
  actor.tokens.add(token);
  let settled = false;
  return {
    owner,
    settle() {
      if (settled) return;
      settled = true;
      const turnId = actorToTurn.get(owner.actorRunId);
      const current = turnId
        ? turns.get(turnId)?.actors.get(owner.actorRunId)
        : undefined;
      if (current !== actor || !actor.tokens.delete(token)) return;
      if (actor.tokens.size === 0) {
        for (const waiter of actor.drainWaiters) waiter();
        actor.drainWaiters.clear();
        const turn = turns.get(owner.turnId);
        if (
          turn?.phase === "finalizing" &&
          [...turn.actors.values()].every(
            (candidate) => candidate.tokens.size === 0,
          )
        ) {
          disposeTurn(owner.turnId, turn);
        }
      }
    },
  };
}

export function reserveSubagentRun(
  owner: MutationActivityOwner,
): ActivityHandle {
  return reserveMutationActivity(owner, "subagent-run");
}

export async function withTrackedMutation<T>(
  ctx: Pick<AgentContext, "mutationActivityOwner">,
  operation: () => Promise<T>,
): Promise<T> {
  const owner = ctx.mutationActivityOwner;
  // Transitional test fixtures may omit owners while they are migrated. All
  // production writable contexts are constructed by the root/child handlers.
  if (!owner) {
    if (process.env.NODE_ENV === "test") return operation();
    throw new DyadError(
      "Writable Local Agent context is missing its mutation owner.",
      DyadErrorKind.Precondition,
    );
  }
  const activity = reserveMutationActivity(owner);
  try {
    return await operation();
  } finally {
    activity.settle();
  }
}

export function closeMutationActor(actorRunId: string): void {
  const turnId = actorToTurn.get(actorRunId);
  const actor = turnId ? turns.get(turnId)?.actors.get(actorRunId) : undefined;
  if (actor) actor.open = false;
}

export function waitForMutationActorDrain(
  actorRunId: string,
  timeoutMs?: number,
): Promise<boolean> {
  const turnId = actorToTurn.get(actorRunId);
  const actor = turnId ? turns.get(turnId)?.actors.get(actorRunId) : undefined;
  if (!actor || actor.tokens.size === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let finished = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const finish = (drained: boolean) => {
      if (finished) return;
      finished = true;
      if (timeout) clearTimeout(timeout);
      actor.drainWaiters.delete(onDrain);
      resolve(drained);
    };
    const onDrain = () => finish(true);
    if (timeoutMs !== undefined) {
      timeout = setTimeout(() => finish(false), timeoutMs);
    }
    actor.drainWaiters.add(onDrain);
    if (actor.tokens.size === 0) finish(true);
  });
}

export function tryBeginTurnFinalization(turnId: string): boolean {
  const turn = turns.get(turnId);
  if (!turn || turn.phase !== "open") return false;
  if ([...turn.actors.values()].some((actor) => actor.tokens.size > 0)) {
    return false;
  }
  turn.phase = "finalizing";
  for (const actor of turn.actors.values()) actor.open = false;
  return true;
}

export function describeTurnActivity(turnId: string): string | null {
  const turn = turns.get(turnId);
  if (!turn) return null;
  const active = [...turn.actors.values()].filter(
    (actor) => actor.tokens.size > 0,
  );
  if (active.length === 0) {
    return turn.phase === "finalizing" ? "This turn is finalizing." : null;
  }
  return active
    .map((actor) => {
      const name = actor.owner.threadId
        ? `${actor.owner.persona ?? "sub-agent"} ${actor.owner.threadId}`
        : "root agent";
      return `${name} (${actor.tokens.size} active operation${actor.tokens.size === 1 ? "" : "s"})`;
    })
    .join(", ");
}

export function endTurnFinalization(turnId: string): void {
  const turn = turns.get(turnId);
  if (!turn) return;
  turn.phase = "finalizing";
  for (const actor of turn.actors.values()) actor.open = false;
  if ([...turn.actors.values()].some((actor) => actor.tokens.size > 0)) return;
  disposeTurn(turnId, turn);
}

function disposeTurn(turnId: string, turn: TurnRecord): void {
  for (const actorRunId of turn.actors.keys()) actorToTurn.delete(actorRunId);
  turns.delete(turnId);
}

export function closeAndDisposeTurnsForChat(chatId: number): string[] {
  const actorRunIds: string[] = [];
  for (const [turnId, turn] of turns) {
    if (turn.chatId !== chatId) continue;
    turn.phase = "finalizing";
    for (const actor of turn.actors.values()) {
      actor.open = false;
      actorRunIds.push(actor.owner.actorRunId);
    }
    if ([...turn.actors.values()].every((actor) => actor.tokens.size === 0)) {
      endTurnFinalization(turnId);
    }
  }
  return actorRunIds;
}

export function normalizeMutationScope(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  const relative = normalized.replace(/^\.\//, "").replace(/\/$/, "");
  return relative === "." ? "" : relative;
}

export function validateMutationScope(scope: string[]): string[] {
  const normalized = scope.map(normalizeMutationScope);
  if (
    normalized.some(
      (value) =>
        value === "" ||
        value === ".." ||
        value.startsWith("../") ||
        path.posix.isAbsolute(value),
    )
  ) {
    throw new DyadError(
      "Implementer scope must contain explicit relative paths within the app.",
      DyadErrorKind.Validation,
    );
  }
  return normalized;
}
