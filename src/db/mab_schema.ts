import { sql, relations } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  real,
  index,
} from "drizzle-orm/sqlite-core";

// =============================================================================
// MULTI-ARMED BANDIT LEARNING TABLES
// Local-first continuous learning via Thompson Sampling
// =============================================================================

/**
 * MAB Arms — each arm is a choice/strategy/action that the system can take.
 * Arms with the same `context_key` compete against each other.
 */
export const mabArms = sqliteTable(
  "mab_arms",
  {
    id: text("id").primaryKey(), // UUID v4
    domain: text("domain", {
      enum: [
        "model_selection",
        "connector_strategy",
        "transform_pipeline",
        "prompt_template",
        "ui_layout",
        "response_style",
        "tool_selection",
        "workflow_routing",
        "custom",
      ],
    }).notNull(),
    name: text("name").notNull(),
    description: text("description"),
    contextKey: text("context_key").notNull(), // Groups competing arms

    // Beta distribution parameters (Thompson Sampling)
    alpha: real("alpha").notNull().default(1.0), // Successes + 1 prior
    beta: real("beta_param").notNull().default(1.0), // Failures + 1 prior (avoid SQL keyword)
    pulls: integer("pulls").notNull().default(0),
    totalReward: real("total_reward").notNull().default(0.0),

    // Metadata (JSON)
    metadataJson: text("metadata_json", { mode: "json" }).$type<
      Record<string, unknown> | null
    >(),

    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(true),

    // Reward-specific timestamp — only updated on recordReward, never on metadata edits.
    // Used for decay age calculation so editing name/description won't reset the decay clock.
    lastRewardAt: integer("last_reward_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    contextKeyIdx: index("mab_arms_context_key_idx").on(table.contextKey),
    domainIdx: index("mab_arms_domain_idx").on(table.domain),
    activeIdx: index("mab_arms_is_active_idx").on(table.isActive),
  }),
);

/**
 * MAB Reward Events — every reward signal recorded for an arm.
 * This is the detailed audit trail for learning decisions.
 */
export const mabRewardEvents = sqliteTable(
  "mab_reward_events",
  {
    id: text("id").primaryKey(), // UUID v4
    armId: text("arm_id")
      .notNull()
      .references(() => mabArms.id, { onDelete: "cascade" }),
    reward: real("reward").notNull(), // 0.0 – 1.0

    // Contextual features at the time of reward (JSON)
    contextJson: text("context_json", { mode: "json" }).$type<
      Record<string, unknown> | null
    >(),

    feedback: text("feedback"), // Optional user comment
    source: text("source", {
      enum: ["auto", "user", "system"],
    })
      .notNull()
      .default("auto"),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => ({
    armIdIdx: index("mab_reward_events_arm_id_idx").on(table.armId),
    createdAtIdx: index("mab_reward_events_created_at_idx").on(
      table.createdAt,
    ),
  }),
);

/**
 * MAB Decay Configuration — per-domain decay settings
 */
export const mabDecayConfig = sqliteTable("mab_decay_config", {
  id: text("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  halfLifeDays: integer("half_life_days").notNull().default(14),
  minPulls: integer("min_pulls").notNull().default(5),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ---- Relations ----

export const mabArmsRelations = relations(mabArms, ({ many }) => ({
  rewardEvents: many(mabRewardEvents),
}));

export const mabRewardEventsRelations = relations(
  mabRewardEvents,
  ({ one }) => ({
    arm: one(mabArms, {
      fields: [mabRewardEvents.armId],
      references: [mabArms.id],
    }),
  }),
);
