import { sql, relations } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  real,
  index,
} from "drizzle-orm/sqlite-core";
import { agents } from "./schema";

// =============================================================================
// AGENT MEMORY TABLES
// Long-Term Memory (cross-conversation) & Short-Term Memory (per-conversation)
// =============================================================================

/**
 * Agent Memory Config — per-agent settings for long-term and short-term memory.
 */
export const agentMemoryConfig = sqliteTable("agent_memory_config", {
  agentId: integer("agent_id")
    .primaryKey()
    .references(() => agents.id, { onDelete: "cascade" }),

  // Long-term memory settings
  longTermEnabled: integer("long_term_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  longTermMaxContext: integer("long_term_max_context").notNull().default(10),

  // Short-term memory settings
  shortTermEnabled: integer("short_term_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  shortTermMaxEntries: integer("short_term_max_entries").notNull().default(50),

  // Auto-extraction
  autoExtract: integer("auto_extract", { mode: "boolean" })
    .notNull()
    .default(false),

  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * Long-Term Memory — facts / preferences / instructions the agent remembers
 * across all conversations.
 */
export const agentLongTermMemory = sqliteTable(
  "agent_long_term_memory",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    category: text("category", {
      enum: ["fact", "preference", "instruction", "context", "skill", "relationship"],
    }).notNull(),

    content: text("content").notNull(),
    key: text("key"), // optional dedup key

    importance: real("importance").notNull().default(0.5),
    accessCount: integer("access_count").notNull().default(0),
    lastAccessedAt: integer("last_accessed_at", { mode: "timestamp" }),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_ltm_agent").on(table.agentId),
    index("idx_ltm_agent_category").on(table.agentId, table.category),
    index("idx_ltm_agent_key").on(table.agentId, table.key),
    index("idx_ltm_importance").on(table.agentId, table.importance),
  ],
);

/**
 * Short-Term Memory — scratchpad / variables the agent maintains within a
 * single conversation. Automatically cleared when the chat ends.
 */
export const agentShortTermMemory = sqliteTable(
  "agent_short_term_memory",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    agentId: integer("agent_id")
      .notNull()
      .references(() => agents.id, { onDelete: "cascade" }),

    chatId: text("chat_id").notNull(),

    kind: text("kind", {
      enum: ["scratchpad", "variable", "plan", "note"],
    }).notNull(),

    key: text("key").notNull(),
    value: text("value").notNull(),

    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (table) => [
    index("idx_stm_agent_chat").on(table.agentId, table.chatId),
    index("idx_stm_agent_chat_key").on(table.agentId, table.chatId, table.key),
  ],
);

// =============================================================================
// RELATIONS
// =============================================================================

export const agentMemoryConfigRelations = relations(
  agentMemoryConfig,
  ({ one }) => ({
    agent: one(agents, {
      fields: [agentMemoryConfig.agentId],
      references: [agents.id],
    }),
  }),
);

export const agentLongTermMemoryRelations = relations(
  agentLongTermMemory,
  ({ one }) => ({
    agent: one(agents, {
      fields: [agentLongTermMemory.agentId],
      references: [agents.id],
    }),
  }),
);

export const agentShortTermMemoryRelations = relations(
  agentShortTermMemory,
  ({ one }) => ({
    agent: one(agents, {
      fields: [agentShortTermMemory.agentId],
      references: [agents.id],
    }),
  }),
);
