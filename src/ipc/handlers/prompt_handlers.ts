import log from "electron-log";
import { db } from "@/db";
import { prompts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { promptContracts } from "../types/prompts";

const _logger = log.scope("prompt_handlers");

export function registerPromptHandlers() {
  createTypedHandler(promptContracts.list, async () => {
    const rows = db.select().from(prompts).all();
    return rows.map((r) => ({
      id: r.id!,
      title: r.title,
      description: r.description,
      content: r.content,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  });

  createTypedHandler(promptContracts.create, async (_, params) => {
    const { title, content, description } = params;
    if (!title || !content) {
      throw new Error("Title and content are required");
    }
    const result = db
      .insert(prompts)
      .values({
        title,
        description,
        content,
      })
      .run();

    const id = Number(result.lastInsertRowid);
    const row = db.select().from(prompts).where(eq(prompts.id, id)).get();
    if (!row) throw new Error("Failed to fetch created prompt");
    return {
      id: row.id!,
      title: row.title,
      description: row.description,
      content: row.content,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  });

  createTypedHandler(promptContracts.update, async (_, params) => {
    const { id, title, content, description } = params;
    if (!id) throw new Error("Prompt id is required");
    const now = new Date();
    const updateData: Record<string, any> = { updatedAt: now };
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (description !== undefined) updateData.description = description;
    db.update(prompts).set(updateData).where(eq(prompts.id, id)).run();
  });

  createTypedHandler(promptContracts.delete, async (_, id) => {
    if (!id) throw new Error("Prompt id is required");
    db.delete(prompts).where(eq(prompts.id, id)).run();
  });
}
