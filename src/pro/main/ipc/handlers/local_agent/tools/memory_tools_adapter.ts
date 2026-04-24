/**
 * Memory System → ToolDefinition Adapter
 *
 * Exposes semantic recall over the user's full memory store
 * (chats, files, scrapes, observations) as `memory_recall`.
 */

import { z } from "zod";
import { memorySystem } from "@/lib/memory_system";
import type { ToolDefinition } from "./types";

const memoryRecallTool: ToolDefinition = {
  name: "memory_recall",
  description:
    "Semantic search over the user's memory (past chats, scraped pages, notes, observations). Use this BEFORE asking the user for context they may have already provided.",
  inputSchema: z.object({
    query: z.string().describe("Natural-language description of what to recall"),
    types: z.array(z.string()).optional(),
    limit: z.number().int().min(1).max(50).optional().default(10),
    minConfidence: z.number().min(0).max(1).optional(),
  }),
  defaultConsent: "always",
  execute: async (args) => {
    const results = await memorySystem.search({
      query: args.query,
      types: args.types as never,
      limit: args.limit,
      minConfidence: args.minConfidence,
    });
    return JSON.stringify(
      results.map((r) => ({
        score: r.score,
        match: r.matchType,
        type: r.memory.type,
        source: r.memory.source,
        content: typeof r.memory.content === "string"
          ? r.memory.content.slice(0, 500)
          : r.memory.content,
        createdAt: r.memory.createdAt,
      })),
      null,
      2,
    );
  },
};

export const MEMORY_AGENT_TOOLS: readonly ToolDefinition[] = [memoryRecallTool];

export function getMemoryAgentToolNames(): string[] {
  return MEMORY_AGENT_TOOLS.map((t) => t.name);
}
