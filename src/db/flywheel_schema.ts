import { sql, relations } from "drizzle-orm";
import { integer, sqliteTable, text, index } from "drizzle-orm/sqlite-core";
import { agents } from "./schema";

// =============================================================================
// DATA FLYWHEEL TABLES
// Interactions → Training Data → Fine-Tune → Smarter Models → Better Interactions
// =============================================================================

/**
 * Flywheel Training Pairs — captured Q&A pairs for model fine-tuning.
 * Sources: chat auto-capture, thumbs feedback, user corrections, agent tests.
 */
export const flywheelTrainingPairs = sqliteTable(
  "flywheel_training_pairs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agentId: integer("agent_id").references(() => agents.id, {
      onDelete: "cascade",
    }),
    appId: integer("app_id"),
    sourceType: text("source_type", {
      enum: ["chat", "openclaw", "agent_test", "correction"],
    }).notNull(),
    userInput: text("user_input").notNull(),
    assistantOutput: text("assistant_output").notNull(),
    rating: text("rating", { enum: ["positive", "negative"] }),
    correctedOutput: text("corrected_output"),
    captured: integer("captured", { mode: "boolean" })
      .notNull()
      .default(false),
    messageId: integer("message_id"),
    model: text("model"),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("flywheel_tp_agent_idx").on(table.agentId),
    index("flywheel_tp_captured_idx").on(table.captured),
  ],
);

/**
 * Flywheel Runs — tracks each training cycle (dataset build → fine-tune job).
 */
export const flywheelRuns = sqliteTable("flywheel_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id").references(() => agents.id, {
    onDelete: "cascade",
  }),
  status: text("status", {
    enum: ["pending", "building_dataset", "training", "completed", "failed"],
  })
    .notNull()
    .default("pending"),
  trainingSamplesCount: integer("training_samples_count").notNull().default(0),
  datasetId: text("dataset_id"),
  jobId: text("job_id"),
  error: text("error"),
  startedAt: integer("started_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

// Relations
export const flywheelTrainingPairsRelations = relations(
  flywheelTrainingPairs,
  ({ one }) => ({
    agent: one(agents, {
      fields: [flywheelTrainingPairs.agentId],
      references: [agents.id],
    }),
  }),
);

export const flywheelRunsRelations = relations(flywheelRuns, ({ one }) => ({
  agent: one(agents, {
    fields: [flywheelRuns.agentId],
    references: [agents.id],
  }),
}));
