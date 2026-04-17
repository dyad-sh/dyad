/**
 * Mission Persistence Service
 *
 * CRUD operations for autonomous missions persisted in SQLite via Drizzle.
 * Keeps mission state across app restarts so the background executor
 * can resume interrupted work.
 */

import { eq, and, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  autonomousMissions,
  type MissionPhaseRow,
} from "@/db/mission_schema";
import { randomUUID } from "node:crypto";

// ============================================================================
// Types
// ============================================================================

export type MissionStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface CreateMissionInput {
  appId?: number;
  agentId?: string;
  title: string;
  description?: string;
  phases?: MissionPhaseRow[];
  targetAppPath?: string;
}

export interface MissionRow {
  id: string;
  appId: number | null;
  agentId: string | null;
  title: string;
  description: string | null;
  status: MissionStatus;
  phases: MissionPhaseRow[] | null;
  currentPhaseIndex: number | null;
  log: string | null;
  verifyAttempts: number;
  lastError: string | null;
  targetAppPath: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

// ============================================================================
// CRUD
// ============================================================================

export function createMission(input: CreateMissionInput): MissionRow {
  const id = randomUUID();
  const now = new Date();

  db.insert(autonomousMissions).values({
    id,
    appId: input.appId ?? null,
    agentId: input.agentId ?? null,
    title: input.title,
    description: input.description ?? null,
    status: "pending",
    phases: input.phases ?? null,
    currentPhaseIndex: null,
    log: "",
    verifyAttempts: 0,
    lastError: null,
    targetAppPath: input.targetAppPath ?? null,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  }).run();

  return getMission(id)!;
}

export function getMission(id: string): MissionRow | undefined {
  return db
    .select()
    .from(autonomousMissions)
    .where(eq(autonomousMissions.id, id))
    .get() as MissionRow | undefined;
}

export function listMissions(filter?: {
  status?: MissionStatus | MissionStatus[];
  appId?: number;
}): MissionRow[] {
  let query = db.select().from(autonomousMissions);

  if (filter?.status) {
    if (Array.isArray(filter.status)) {
      query = query.where(inArray(autonomousMissions.status, filter.status)) as any;
    } else {
      query = query.where(eq(autonomousMissions.status, filter.status)) as any;
    }
  }
  if (filter?.appId != null) {
    query = query.where(eq(autonomousMissions.appId, filter.appId)) as any;
  }

  return query.all() as MissionRow[];
}

export function updateMissionStatus(
  id: string,
  status: MissionStatus,
  extra?: { lastError?: string; completedAt?: Date },
): void {
  db.update(autonomousMissions)
    .set({
      status,
      updatedAt: new Date(),
      ...(extra?.lastError != null ? { lastError: extra.lastError } : {}),
      ...(extra?.completedAt != null ? { completedAt: extra.completedAt } : {}),
    })
    .where(eq(autonomousMissions.id, id))
    .run();
}

export function updateMissionPhase(
  id: string,
  phaseIndex: number,
  phases: MissionPhaseRow[],
): void {
  db.update(autonomousMissions)
    .set({
      currentPhaseIndex: phaseIndex,
      phases,
      updatedAt: new Date(),
    })
    .where(eq(autonomousMissions.id, id))
    .run();
}

export function appendMissionLog(id: string, line: string): void {
  const mission = getMission(id);
  if (!mission) return;

  // Cap log at ~100KB
  const currentLog = mission.log ?? "";
  const maxLen = 100_000;
  const trimmed =
    currentLog.length + line.length > maxLen
      ? currentLog.slice(-(maxLen - line.length))
      : currentLog;

  db.update(autonomousMissions)
    .set({ log: trimmed + line + "\n", updatedAt: new Date() })
    .where(eq(autonomousMissions.id, id))
    .run();
}

export function incrementVerifyAttempts(id: string): void {
  const mission = getMission(id);
  if (!mission) return;
  db.update(autonomousMissions)
    .set({
      verifyAttempts: mission.verifyAttempts + 1,
      updatedAt: new Date(),
    })
    .where(eq(autonomousMissions.id, id))
    .run();
}

/**
 * Return missions that were "running" when the app last shut down,
 * so the background executor can decide whether to resume them.
 */
export function getInterruptedMissions(): MissionRow[] {
  return listMissions({ status: "running" });
}

export function cancelMission(id: string): void {
  updateMissionStatus(id, "cancelled");
}

export function deleteMission(id: string): void {
  db.delete(autonomousMissions)
    .where(eq(autonomousMissions.id, id))
    .run();
}

export function updateMissionMeta(
  id: string,
  updates: { title?: string; description?: string },
): void {
  db.update(autonomousMissions)
    .set({
      ...(updates.title != null ? { title: updates.title } : {}),
      ...(updates.description != null ? { description: updates.description } : {}),
      updatedAt: new Date(),
    })
    .where(eq(autonomousMissions.id, id))
    .run();
}
