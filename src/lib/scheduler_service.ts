/**
 * Scheduler Service
 *
 * Persistent cron-style scheduler. Each schedule pairs a cron expression with
 * an "action" — a tool name + args invocation. When the cron fires, the
 * action is dispatched through the agent tool runtime. Survives restarts via
 * SQLite persistence.
 *
 * Cron support: standard 5-field expressions (minute hour day-of-month month
 * day-of-week). Implemented in-house (one tick per minute) to avoid adding a
 * dependency.
 */

import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import log from "electron-log";

const logger = log.scope("scheduler_service");

export type ScheduleId = string & { __brand: "ScheduleId" };

export interface ScheduleAction {
  toolName: string;
  args: Record<string, unknown>;
}

export interface Schedule {
  id: ScheduleId;
  name: string;
  cron: string;
  action: ScheduleAction;
  enabled: boolean;
  ownerId: string;
  ownerKind: "user" | "agent" | "plugin";
  lastRunAt: number | null;
  nextRunAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type ToolDispatcher = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

interface CronFields {
  minute: number[];
  hour: number[];
  day: number[];
  month: number[];
  dow: number[];
}

const RANGES: Record<keyof CronFields, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  day: [1, 31],
  month: [1, 12],
  dow: [0, 6],
};

function parseCronField(field: string, key: keyof CronFields): number[] {
  const [min, max] = RANGES[key];
  if (field === "*") return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  const result = new Set<number>();
  for (const part of field.split(",")) {
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? Number.parseInt(stepMatch[2], 10) : 1;
    const body = stepMatch ? stepMatch[1] : part;
    let lo = min;
    let hi = max;
    if (body !== "*") {
      const range = body.match(/^(\d+)(?:-(\d+))?$/);
      if (!range) throw new Error(`Invalid cron field: ${field}`);
      lo = Number.parseInt(range[1], 10);
      hi = range[2] ? Number.parseInt(range[2], 10) : lo;
    }
    for (let v = lo; v <= hi; v += step) {
      if (v >= min && v <= max) result.add(v);
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Cron expression must have 5 fields: ${expr}`);
  return {
    minute: parseCronField(parts[0], "minute"),
    hour: parseCronField(parts[1], "hour"),
    day: parseCronField(parts[2], "day"),
    month: parseCronField(parts[3], "month"),
    dow: parseCronField(parts[4], "dow"),
  };
}

function matchesCron(fields: CronFields, date: Date): boolean {
  return (
    fields.minute.includes(date.getMinutes()) &&
    fields.hour.includes(date.getHours()) &&
    fields.day.includes(date.getDate()) &&
    fields.month.includes(date.getMonth() + 1) &&
    fields.dow.includes(date.getDay())
  );
}

function nextFireTime(fields: CronFields, from: Date): number {
  const candidate = new Date(from.getTime() + 60_000);
  candidate.setSeconds(0, 0);
  for (let i = 0; i < 60 * 24 * 366; i++) {
    if (matchesCron(fields, candidate)) return candidate.getTime();
    candidate.setMinutes(candidate.getMinutes() + 1);
  }
  return 0;
}

export class SchedulerService extends EventEmitter {
  private db: Database.Database | null = null;
  private dir: string;
  private timer: NodeJS.Timeout | null = null;
  private dispatcher: ToolDispatcher | null = null;

  constructor() {
    super();
    this.dir = path.join(app.getPath("userData"), "scheduler");
  }

  setDispatcher(d: ToolDispatcher): void {
    this.dispatcher = d;
  }

  async initialize(): Promise<void> {
    if (this.db) return;
    await fs.mkdir(this.dir, { recursive: true });
    this.db = new Database(path.join(this.dir, "scheduler.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron TEXT NOT NULL,
        action TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        owner_id TEXT NOT NULL,
        owner_kind TEXT NOT NULL,
        last_run_at INTEGER,
        next_run_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    this.start();
    logger.info("Scheduler service initialized");
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("Scheduler not initialized");
    return this.db;
  }

  private start(): void {
    if (this.timer) return;
    // Align to the start of the next minute, then tick every minute.
    const msToNextMinute = 60_000 - (Date.now() % 60_000);
    setTimeout(() => {
      this.tick().catch((err) => logger.error("scheduler tick error", err));
      this.timer = setInterval(() => {
        this.tick().catch((err) => logger.error("scheduler tick error", err));
      }, 60_000);
    }, msToNextMinute);
  }

  shutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  create(params: {
    name: string;
    cron: string;
    action: ScheduleAction;
    ownerId: string;
    ownerKind: Schedule["ownerKind"];
    enabled?: boolean;
  }): Schedule {
    const fields = parseCron(params.cron); // validate now
    const db = this.requireDb();
    const now = Date.now();
    const id = randomUUID() as ScheduleId;
    const schedule: Schedule = {
      id,
      name: params.name,
      cron: params.cron,
      action: params.action,
      enabled: params.enabled ?? true,
      ownerId: params.ownerId,
      ownerKind: params.ownerKind,
      lastRunAt: null,
      nextRunAt: nextFireTime(fields, new Date(now)),
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(
      `INSERT INTO schedules (id, name, cron, action, enabled, owner_id, owner_kind, last_run_at, next_run_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      schedule.id,
      schedule.name,
      schedule.cron,
      JSON.stringify(schedule.action),
      schedule.enabled ? 1 : 0,
      schedule.ownerId,
      schedule.ownerKind,
      schedule.lastRunAt,
      schedule.nextRunAt,
      schedule.createdAt,
      schedule.updatedAt,
    );
    return schedule;
  }

  list(): Schedule[] {
    return (this.requireDb().prepare("SELECT * FROM schedules ORDER BY created_at DESC").all() as Array<
      Record<string, unknown>
    >).map(this.rowToSchedule);
  }

  remove(id: ScheduleId): void {
    const r = this.requireDb().prepare("DELETE FROM schedules WHERE id = ?").run(id);
    if (r.changes === 0) throw new Error(`Schedule not found: ${id}`);
  }

  setEnabled(id: ScheduleId, enabled: boolean): void {
    const r = this.requireDb()
      .prepare("UPDATE schedules SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(enabled ? 1 : 0, Date.now(), id);
    if (r.changes === 0) throw new Error(`Schedule not found: ${id}`);
  }

  private async tick(): Promise<void> {
    const now = new Date();
    now.setSeconds(0, 0);
    const nowMs = now.getTime();
    const db = this.requireDb();
    const due = db
      .prepare("SELECT * FROM schedules WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)")
      .all(nowMs) as Array<Record<string, unknown>>;

    for (const row of due) {
      const schedule = this.rowToSchedule(row);
      let fields: CronFields;
      try {
        fields = parseCron(schedule.cron);
      } catch (err) {
        logger.error(`Invalid cron in schedule ${schedule.id}: ${err}`);
        continue;
      }
      if (!matchesCron(fields, now)) {
        // Re-align next_run_at and skip
        db.prepare("UPDATE schedules SET next_run_at = ? WHERE id = ?").run(
          nextFireTime(fields, now),
          schedule.id,
        );
        continue;
      }
      if (this.dispatcher) {
        try {
          await this.dispatcher(schedule.action.toolName, schedule.action.args);
          this.emit("schedule:fired", schedule);
        } catch (err) {
          logger.error(`Schedule ${schedule.name} failed:`, err);
          this.emit("schedule:error", { schedule, error: err });
        }
      } else {
        logger.warn(`No dispatcher; skipping ${schedule.name}`);
      }
      db.prepare("UPDATE schedules SET last_run_at = ?, next_run_at = ? WHERE id = ?").run(
        nowMs,
        nextFireTime(fields, now),
        schedule.id,
      );
    }
  }

  private rowToSchedule = (row: Record<string, unknown>): Schedule => ({
    id: String(row.id) as ScheduleId,
    name: String(row.name),
    cron: String(row.cron),
    action: JSON.parse(String(row.action ?? "{}")),
    enabled: Number(row.enabled) === 1,
    ownerId: String(row.owner_id),
    ownerKind: String(row.owner_kind) as Schedule["ownerKind"],
    lastRunAt: row.last_run_at == null ? null : Number(row.last_run_at),
    nextRunAt: row.next_run_at == null ? null : Number(row.next_run_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  });
}

let _instance: SchedulerService | null = null;
export function getSchedulerService(): SchedulerService {
  if (!_instance) _instance = new SchedulerService();
  return _instance;
}
