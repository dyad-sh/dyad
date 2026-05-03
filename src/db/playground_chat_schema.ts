/**
 * Local-AI Playground Chat persistence.
 *
 * Replaces the previous in-memory `Map` in `trustless_inference_service.ts`
 * so playground conversations survive app restarts and can be monetized
 * (individual prompts/responses linked to JoyMarketplace assets).
 */

import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** One playground conversation (chat thread). Persisted across restarts. */
export const playgroundConversations = sqliteTable("playground_conversations", {
  /** UUID — matches the in-memory id used previously by `InferenceConversation`. */
  id: text("id").primaryKey(),
  title: text("title").notNull().default("New Conversation"),
  /** Local provider id (ollama, lmstudio, llamacpp, etc.) */
  provider: text("provider").notNull(),
  /** Model name as known to the provider (e.g. "llama3.2:3b") */
  modelId: text("model_id").notNull(),
  systemPrompt: text("system_prompt"),
  /** Inference record IDs (one per assistant turn) — JSON array of strings */
  recordIds: text("record_ids", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'`),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** Individual messages within a playground conversation. */
export const playgroundMessages = sqliteTable("playground_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id")
    .notNull()
    .references(() => playgroundConversations.id, { onDelete: "cascade" }),
  /** "user" | "assistant" | "system" */
  role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
  content: text("content").notNull(),
  /** Inference record id (Helia/IPFS) for assistant turns; null for user/system. */
  recordId: text("record_id"),
  /** Helia CID (when verified) — duplicated here for fast lookup without joining records. */
  cid: text("cid"),
  /** Marketplace asset id once this message has been published for monetization. */
  marketplaceAssetId: text("marketplace_asset_id"),
  /** Listing price in wei (string to avoid JS number precision loss). */
  priceWei: text("price_wei"),
  /** Free text — what the user offers (e.g. "Best coding system prompt v2"). */
  monetizeTitle: text("monetize_title"),
  monetizeDescription: text("monetize_description"),
  monetizedAt: integer("monetized_at", { mode: "timestamp" }),
  /** Position in the conversation, 0-based. */
  ordinal: integer("ordinal").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type PlaygroundConversationRow = typeof playgroundConversations.$inferSelect;
export type PlaygroundMessageRow = typeof playgroundMessages.$inferSelect;
