/**
 * MCP Tools — Knowledge Base / Library
 *
 * Search and add items in the JoyCreate local library (libraryItems table).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getDb } from "@/db";
import { libraryItems } from "@/db/schema";
import { like, desc, eq } from "drizzle-orm";

export function registerKnowledgeBaseTools(server: McpServer) {
  // ── Search knowledge / library ───────────────────────────────────
  server.registerTool(
    "joycreate_search_knowledge",
    {
      description:
        "Search the JoyCreate library for files, documents, and knowledge items by name, category, or tags.",
      inputSchema: {
        search: z.string().optional().describe("Search by name or description"),
        category: z.string().optional().describe("Filter by category"),
        mimeType: z.string().optional().describe("Filter by MIME type (e.g. application/pdf)"),
        limit: z.number().optional().describe("Max results (default 20)"),
      },
    },
    async ({ search, category, mimeType, limit }) => {
      const db = getDb();
      let query = db
        .select({
          id: libraryItems.id,
          name: libraryItems.name,
          description: libraryItems.description,
          mimeType: libraryItems.mimeType,
          byteSize: libraryItems.byteSize,
          category: libraryItems.category,
          tags: libraryItems.tags,
          pinned: libraryItems.pinned,
          createdAt: libraryItems.createdAt,
        })
        .from(libraryItems)
        .$dynamic();

      if (search) {
        query = query.where(like(libraryItems.name, `%${search}%`));
      }
      if (category) {
        query = query.where(eq(libraryItems.category, category));
      }
      if (mimeType) {
        query = query.where(eq(libraryItems.mimeType, mimeType));
      }

      const rows = await query
        .orderBy(desc(libraryItems.updatedAt))
        .limit(limit ?? 20);

      return {
        content: [{ type: "text" as const, text: JSON.stringify(rows, null, 2) }],
      };
    },
  );

  // ── Add to library ───────────────────────────────────────────────
  server.registerTool(
    "joycreate_add_to_library",
    {
      description:
        "Add a new item to the JoyCreate knowledge library. Provide metadata about a file that has already been stored on disk.",
      inputSchema: {
        name: z.string().describe("Item name"),
        description: z.string().optional().describe("Item description"),
        mimeType: z.string().describe("MIME type (e.g. text/plain, application/pdf)"),
        byteSize: z.number().describe("File size in bytes"),
        contentHash: z.string().describe("SHA-256 hash of file content"),
        storagePath: z.string().describe("Absolute path to the stored file"),
        category: z.string().optional().describe("Category label"),
        tags: z.array(z.string()).optional().describe("Array of tags"),
      },
    },
    async ({ name, description, mimeType, byteSize, contentHash, storagePath, category, tags }) => {
      const db = getDb();
      const [created] = await db
        .insert(libraryItems)
        .values({
          name,
          description: description ?? null,
          mimeType,
          byteSize,
          contentHash,
          storagePath,
          category: category ?? null,
          tags: tags ?? [],
        })
        .returning({ id: libraryItems.id, name: libraryItems.name });

      return {
        content: [
          {
            type: "text" as const,
            text: `Library item added: ${created.name} (ID: ${created.id})`,
          },
        ],
      };
    },
  );
}
