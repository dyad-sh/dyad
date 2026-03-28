import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { apps } from "./schema";

// =============================================================================
// AUTONOMOUS MISSION TABLES
// Persisted missions that survive app restarts and run in the background.
// =============================================================================

export const autonomousMissions = sqliteTable(
  "autonomous_missions",
  {
    id: text("id").primaryKey(), // UUID
    appId: integer("app_id").references(() => apps.id, { onDelete: "cascade" }),
    agentId: text("agent_id"), // AutonomousAgentId from autonomous_agent.ts
    title: text("title").notNull(),
    description: text("description"),
    status: text("status", {
      enum: ["pending", "running", "paused", "completed", "failed", "cancelled"],
    })
      .notNull()
      .default("pending"),
    /** JSON-serialised mission phases */
    phases: text("phases", { mode: "json" }).$type<MissionPhaseRow[]>(),
    /** Index of the phase currently executing (null if not started) */
    currentPhaseIndex: integer("current_phase_index"),
    /** Accumulated log lines (capped on write) */
    log: text("log").default(""),
    /** Number of verification attempts so far */
    verifyAttempts: integer("verify_attempts").notNull().default(0),
    /** Last error message if status is 'failed' */
    lastError: text("last_error"),
    /** App path at mission creation time (snapshot) */
    targetAppPath: text("target_app_path"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    completedAt: integer("completed_at", { mode: "timestamp" }),
  },
  (table) => ({
    statusIdx: index("idx_missions_status").on(table.status),
    appIdx: index("idx_missions_app").on(table.appId),
  }),
);

/** Lightweight row type for JSON-serialised phases */
export interface MissionPhaseRow {
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  actions: number;
  errors: number;
  startedAt?: number;
  completedAt?: number;
}
