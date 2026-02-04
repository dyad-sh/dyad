import log from "electron-log";
import { db } from "@/db";
import { memories } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { memoryContracts } from "../types/memory";

const _logger = log.scope("memory_handlers");

export function registerMemoryHandlers() {
  createTypedHandler(memoryContracts.listByApp, async (_, appId) => {
    const rows = db
      .select()
      .from(memories)
      .where(eq(memories.appId, appId))
      .all();
    return rows.map((r) => ({
      id: r.id!,
      appId: r.appId,
      content: r.content,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  });

  createTypedHandler(memoryContracts.create, async (_, params) => {
    const { appId, content } = params;
    if (!content || !content.trim()) {
      throw new Error("Memory content is required");
    }
    const result = db
      .insert(memories)
      .values({
        appId,
        content: content.trim(),
      })
      .run();

    const id = Number(result.lastInsertRowid);
    const row = db.select().from(memories).where(eq(memories.id, id)).get();
    if (!row) throw new Error("Failed to fetch created memory");
    return {
      id: row.id!,
      appId: row.appId,
      content: row.content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  createTypedHandler(memoryContracts.update, async (_, params) => {
    const { id, content } = params;
    if (!id) throw new Error("Memory id is required");
    if (!content || !content.trim()) {
      throw new Error("Memory content is required");
    }
    const now = new Date();
    db.update(memories)
      .set({ content: content.trim(), updatedAt: now })
      .where(eq(memories.id, id))
      .run();
  });

  createTypedHandler(memoryContracts.delete, async (_, id) => {
    if (!id) throw new Error("Memory id is required");
    db.delete(memories).where(eq(memories.id, id)).run();
  });
}
