import { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { db } from "@/db";
import { prompts } from "@/db/schema";
import { eq } from "drizzle-orm";

const logger = log.scope("prompt_handlers");
const handle = createLoggedHandler(logger);

export type PromptRecord = {
  id: number;
  title: string;
  description: string | null;
  content: string;
  createdAt: Date;
  updatedAt: Date;
};

export interface CreatePromptParams {
  title: string;
  description?: string;
  content: string;
}

export interface UpdatePromptParams extends CreatePromptParams {
  id: number;
}

export function registerPromptHandlers() {
  handle("prompts:list", async (): Promise<PromptRecord[]> => {
    const rows = db.select().from(prompts).all();
    return rows.map((r) => ({
      id: r.id!,
      title: r.title,
      description: r.description ?? null,
      content: r.content,
      createdAt: r.createdAt as unknown as Date,
      updatedAt: r.updatedAt as unknown as Date,
    }));
  });

  handle(
    "prompts:create",
    async (
      _e: IpcMainInvokeEvent,
      params: CreatePromptParams,
    ): Promise<PromptRecord> => {
      const { title, description, content } = params;
      if (!title || !content) {
        throw new Error("Title and content are required");
      }
      const result = db
        .insert(prompts)
        .values({
          title,
          description: description ?? null,
          content,
        })
        .run();

      const id = Number(result.lastInsertRowid);
      const row = db.select().from(prompts).where(eq(prompts.id, id)).get();
      if (!row) throw new Error("Failed to fetch created prompt");
      return {
        id: row.id!,
        title: row.title,
        description: row.description ?? null,
        content: row.content,
        createdAt: row.createdAt as unknown as Date,
        updatedAt: row.updatedAt as unknown as Date,
      };
    },
  );

  handle(
    "prompts:update",
    async (
      _e: IpcMainInvokeEvent,
      params: UpdatePromptParams,
    ): Promise<void> => {
      const { id, title, description, content } = params;
      if (!id) throw new Error("Prompt id is required");
      if (!title || !content) throw new Error("Title and content are required");
      const now = new Date();
      db.update(prompts)
        .set({
          title,
          description: description ?? null,
          content,
          updatedAt: now as unknown as any,
        })
        .where(eq(prompts.id, id))
        .run();
    },
  );

  handle(
    "prompts:delete",
    async (_e: IpcMainInvokeEvent, id: number): Promise<void> => {
      if (!id) throw new Error("Prompt id is required");
      db.delete(prompts).where(eq(prompts.id, id)).run();
    },
  );
}
