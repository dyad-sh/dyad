/**
 * Agent Memory Engine
 * ====================
 * Long-Term Memory: persists facts, preferences, instructions across conversations.
 * Short-Term Memory: scratchpad / variables that live within one conversation.
 *
 * Everything is stored in SQLite via drizzle — fully local, zero cloud.
 */

import log from "electron-log";
import { eq, and, like, desc, sql } from "drizzle-orm";
import { db } from "../db";
import {
  agentMemoryConfig,
  agentLongTermMemory,
  agentShortTermMemory,
} from "../db/agent_memory_schema";
import type {
  AgentMemoryConfig,
  LongTermMemory,
  LongTermMemoryCategory,
  ShortTermMemory,
  ShortTermMemoryKind,
} from "../types/agent_memory";

const logger = log.scope("agent_memory_engine");

// =============================================================================
// CONFIG
// =============================================================================

export async function getMemoryConfig(
  agentId: number,
): Promise<AgentMemoryConfig | null> {
  const rows = await db
    .select()
    .from(agentMemoryConfig)
    .where(eq(agentMemoryConfig.agentId, agentId))
    .limit(1);
  return (rows[0] as AgentMemoryConfig) ?? null;
}

export async function upsertMemoryConfig(params: {
  agentId: number;
  longTermEnabled?: boolean;
  longTermMaxContext?: number;
  shortTermEnabled?: boolean;
  shortTermMaxEntries?: number;
  autoExtract?: boolean;
}): Promise<AgentMemoryConfig> {
  const existing = await getMemoryConfig(params.agentId);

  if (existing) {
    await db
      .update(agentMemoryConfig)
      .set({
        ...(params.longTermEnabled !== undefined && {
          longTermEnabled: params.longTermEnabled,
        }),
        ...(params.longTermMaxContext !== undefined && {
          longTermMaxContext: params.longTermMaxContext,
        }),
        ...(params.shortTermEnabled !== undefined && {
          shortTermEnabled: params.shortTermEnabled,
        }),
        ...(params.shortTermMaxEntries !== undefined && {
          shortTermMaxEntries: params.shortTermMaxEntries,
        }),
        ...(params.autoExtract !== undefined && {
          autoExtract: params.autoExtract,
        }),
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(agentMemoryConfig.agentId, params.agentId));
  } else {
    await db.insert(agentMemoryConfig).values({
      agentId: params.agentId,
      longTermEnabled: params.longTermEnabled ?? false,
      longTermMaxContext: params.longTermMaxContext ?? 10,
      shortTermEnabled: params.shortTermEnabled ?? false,
      shortTermMaxEntries: params.shortTermMaxEntries ?? 50,
      autoExtract: params.autoExtract ?? false,
    });
  }

  return (await getMemoryConfig(params.agentId))!;
}

// =============================================================================
// LONG-TERM MEMORY CRUD
// =============================================================================

export async function createLongTermMemory(params: {
  agentId: number;
  category: LongTermMemoryCategory;
  content: string;
  key?: string;
  importance?: number;
}): Promise<LongTermMemory> {
  // If a key is provided, check for deduplication
  if (params.key) {
    const existing = await db
      .select()
      .from(agentLongTermMemory)
      .where(
        and(
          eq(agentLongTermMemory.agentId, params.agentId),
          eq(agentLongTermMemory.key, params.key),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      // Update existing memory with same key
      await db
        .update(agentLongTermMemory)
        .set({
          content: params.content,
          category: params.category,
          importance: params.importance ?? existing[0].importance,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(agentLongTermMemory.id, existing[0].id));

      const [updated] = await db
        .select()
        .from(agentLongTermMemory)
        .where(eq(agentLongTermMemory.id, existing[0].id));
      return updated as LongTermMemory;
    }
  }

  const [inserted] = await db
    .insert(agentLongTermMemory)
    .values({
      agentId: params.agentId,
      category: params.category,
      content: params.content,
      key: params.key ?? null,
      importance: params.importance ?? 0.5,
    })
    .returning();

  return inserted as LongTermMemory;
}

export async function getLongTermMemory(
  id: number,
): Promise<LongTermMemory | null> {
  const rows = await db
    .select()
    .from(agentLongTermMemory)
    .where(eq(agentLongTermMemory.id, id))
    .limit(1);
  return (rows[0] as LongTermMemory) ?? null;
}

export async function listLongTermMemories(
  agentId: number,
  category?: LongTermMemoryCategory,
): Promise<LongTermMemory[]> {
  const conditions = [eq(agentLongTermMemory.agentId, agentId)];
  if (category) {
    conditions.push(eq(agentLongTermMemory.category, category));
  }
  const rows = await db
    .select()
    .from(agentLongTermMemory)
    .where(and(...conditions))
    .orderBy(desc(agentLongTermMemory.importance));
  return rows as LongTermMemory[];
}

export async function updateLongTermMemory(
  id: number,
  updates: {
    category?: LongTermMemoryCategory;
    content?: string;
    key?: string;
    importance?: number;
  },
): Promise<LongTermMemory | null> {
  const existing = await getLongTermMemory(id);
  if (!existing) return null;

  await db
    .update(agentLongTermMemory)
    .set({
      ...(updates.category !== undefined && { category: updates.category }),
      ...(updates.content !== undefined && { content: updates.content }),
      ...(updates.key !== undefined && { key: updates.key }),
      ...(updates.importance !== undefined && {
        importance: updates.importance,
      }),
      updatedAt: sql`(unixepoch())`,
    })
    .where(eq(agentLongTermMemory.id, id));

  return getLongTermMemory(id);
}

export async function deleteLongTermMemory(id: number): Promise<void> {
  await db
    .delete(agentLongTermMemory)
    .where(eq(agentLongTermMemory.id, id));
}

/**
 * Simple text-based search of long-term memories.
 * For a production system, you'd use FTS5 or vector search here.
 */
export async function searchLongTermMemories(params: {
  agentId: number;
  query: string;
  limit?: number;
  category?: LongTermMemoryCategory;
}): Promise<LongTermMemory[]> {
  const conditions = [eq(agentLongTermMemory.agentId, params.agentId)];
  if (params.category) {
    conditions.push(eq(agentLongTermMemory.category, params.category));
  }
  // Simple LIKE search — good enough for modest memory counts
  conditions.push(
    like(agentLongTermMemory.content, `%${params.query}%`),
  );

  const rows = await db
    .select()
    .from(agentLongTermMemory)
    .where(and(...conditions))
    .orderBy(desc(agentLongTermMemory.importance))
    .limit(params.limit ?? 20);

  return rows as LongTermMemory[];
}

/**
 * Retrieve top-N most important memories for context injection.
 * Bumps accessCount + lastAccessedAt for each returned memory.
 */
export async function getContextMemories(
  agentId: number,
  limit: number,
): Promise<LongTermMemory[]> {
  const rows = await db
    .select()
    .from(agentLongTermMemory)
    .where(eq(agentLongTermMemory.agentId, agentId))
    .orderBy(desc(agentLongTermMemory.importance))
    .limit(limit);

  if (rows.length > 0) {
    const ids = rows.map((r) => r.id);
    // Batch update access metadata
    for (const id of ids) {
      await db
        .update(agentLongTermMemory)
        .set({
          accessCount: sql`${agentLongTermMemory.accessCount} + 1`,
          lastAccessedAt: sql`(unixepoch())`,
        })
        .where(eq(agentLongTermMemory.id, id));
    }
  }

  return rows as LongTermMemory[];
}

// =============================================================================
// SHORT-TERM MEMORY CRUD
// =============================================================================

export async function setShortTermMemory(params: {
  agentId: number;
  chatId: string;
  kind: ShortTermMemoryKind;
  key: string;
  value: string;
}): Promise<ShortTermMemory> {
  // Upsert by (agentId, chatId, key)
  const existing = await db
    .select()
    .from(agentShortTermMemory)
    .where(
      and(
        eq(agentShortTermMemory.agentId, params.agentId),
        eq(agentShortTermMemory.chatId, params.chatId),
        eq(agentShortTermMemory.key, params.key),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(agentShortTermMemory)
      .set({
        value: params.value,
        kind: params.kind,
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(agentShortTermMemory.id, existing[0].id));

    const [updated] = await db
      .select()
      .from(agentShortTermMemory)
      .where(eq(agentShortTermMemory.id, existing[0].id));
    return updated as ShortTermMemory;
  }

  // Enforce max entries per conversation
  const config = await getMemoryConfig(params.agentId);
  const maxEntries = config?.shortTermMaxEntries ?? 50;

  const count = await db
    .select({ count: sql<number>`count(*)` })
    .from(agentShortTermMemory)
    .where(
      and(
        eq(agentShortTermMemory.agentId, params.agentId),
        eq(agentShortTermMemory.chatId, params.chatId),
      ),
    );

  if (count[0].count >= maxEntries) {
    // Delete oldest entry to make room
    const oldest = await db
      .select({ id: agentShortTermMemory.id })
      .from(agentShortTermMemory)
      .where(
        and(
          eq(agentShortTermMemory.agentId, params.agentId),
          eq(agentShortTermMemory.chatId, params.chatId),
        ),
      )
      .orderBy(agentShortTermMemory.createdAt)
      .limit(1);

    if (oldest.length > 0) {
      await db
        .delete(agentShortTermMemory)
        .where(eq(agentShortTermMemory.id, oldest[0].id));
    }
  }

  const [inserted] = await db
    .insert(agentShortTermMemory)
    .values({
      agentId: params.agentId,
      chatId: params.chatId,
      kind: params.kind,
      key: params.key,
      value: params.value,
    })
    .returning();

  return inserted as ShortTermMemory;
}

export async function getShortTermMemories(
  agentId: number,
  chatId: string,
): Promise<ShortTermMemory[]> {
  const rows = await db
    .select()
    .from(agentShortTermMemory)
    .where(
      and(
        eq(agentShortTermMemory.agentId, agentId),
        eq(agentShortTermMemory.chatId, chatId),
      ),
    )
    .orderBy(agentShortTermMemory.createdAt);

  return rows as ShortTermMemory[];
}

export async function deleteShortTermMemory(
  agentId: number,
  chatId: string,
  key: string,
): Promise<void> {
  await db
    .delete(agentShortTermMemory)
    .where(
      and(
        eq(agentShortTermMemory.agentId, agentId),
        eq(agentShortTermMemory.chatId, chatId),
        eq(agentShortTermMemory.key, key),
      ),
    );
}

export async function clearShortTermMemory(
  agentId: number,
  chatId: string,
): Promise<void> {
  await db
    .delete(agentShortTermMemory)
    .where(
      and(
        eq(agentShortTermMemory.agentId, agentId),
        eq(agentShortTermMemory.chatId, chatId),
      ),
    );
}

// =============================================================================
// CONTEXT BUILDER — formats memory for system prompt injection
// =============================================================================

/**
 * Build a formatted string of agent memories to inject into the system prompt.
 * Returns null if agent has no memory config or memory is disabled.
 */
export async function buildMemoryContext(
  agentId: number,
  chatId?: string,
): Promise<string | null> {
  const config = await getMemoryConfig(agentId);
  if (!config) return null;

  const sections: string[] = [];

  // Long-term memories
  if (config.longTermEnabled) {
    const memories = await getContextMemories(
      agentId,
      config.longTermMaxContext,
    );
    if (memories.length > 0) {
      sections.push("## Long-Term Memory (persistent across conversations)");
      for (const mem of memories) {
        sections.push(`- [${mem.category}] ${mem.content}`);
      }
    }
  }

  // Short-term memories (only if chatId is provided)
  if (config.shortTermEnabled && chatId) {
    const stm = await getShortTermMemories(agentId, chatId);
    if (stm.length > 0) {
      sections.push(
        "\n## Short-Term Memory (this conversation only)",
      );
      for (const entry of stm) {
        sections.push(`- [${entry.kind}] ${entry.key}: ${entry.value}`);
      }
    }
  }

  if (sections.length === 0) return null;

  return `\n# Agent Memory\n${sections.join("\n")}\n`;
}

/**
 * Auto-extract facts from an assistant response.
 * This is a simple heuristic: looks for "I'll remember" / "noted" patterns.
 * In production, you'd use an LLM call for structured extraction.
 */
export async function autoExtractMemories(
  agentId: number,
  userMessage: string,
  assistantResponse: string,
): Promise<LongTermMemory[]> {
  const config = await getMemoryConfig(agentId);
  if (!config?.autoExtract || !config.longTermEnabled) return [];

  const extracted: LongTermMemory[] = [];

  // Pattern: user says "remember that X" or "my name is X"
  const rememberPatterns = [
    /remember\s+that\s+(.+)/i,
    /my\s+name\s+is\s+(.+)/i,
    /i\s+prefer\s+(.+)/i,
    /always\s+use\s+(.+)/i,
    /don'?t\s+forget\s+(.+)/i,
    /note\s+that\s+(.+)/i,
  ];

  for (const pattern of rememberPatterns) {
    const match = userMessage.match(pattern);
    if (match?.[1]) {
      const content = match[1].replace(/[.!?]+$/, "").trim();
      if (content.length > 3) {
        try {
          const mem = await createLongTermMemory({
            agentId,
            category: pattern.source.includes("prefer")
              ? "preference"
              : "fact",
            content,
            importance: 0.7,
          });
          extracted.push(mem);
          logger.info(
            `Auto-extracted memory for agent ${agentId}: "${content}"`,
          );
        } catch (err) {
          logger.warn("Failed to auto-extract memory:", err);
        }
      }
    }
  }

  return extracted;
}
