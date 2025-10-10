import { IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { db } from "@/db";
import { prompts } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  CreatePromptParamsDto,
  PromptDto,
  UpdatePromptParamsDto,
} from "../ipc_types";
import { readSettings } from "@/main/settings";
import { getModelClient } from "../utils/get_model_client";
import { streamText, TextStreamPart, ToolSet } from "ai";
import { IS_TEST_BUILD } from "../utils/test_utils";

const logger = log.scope("prompt_handlers");
const handle = createLoggedHandler(logger);

export function registerPromptHandlers() {
  handle("prompts:list", async (): Promise<PromptDto[]> => {
    const rows = db.select().from(prompts).all();
    return rows.map((r) => ({
      id: r.id!,
      title: r.title,
      description: r.description ?? null,
      content: r.content,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  });

  handle(
    "prompts:create",
    async (
      _e: IpcMainInvokeEvent,
      params: CreatePromptParamsDto,
    ): Promise<PromptDto> => {
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
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    },
  );

  handle(
    "prompts:update",
    async (
      _e: IpcMainInvokeEvent,
      params: UpdatePromptParamsDto,
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
          updatedAt: now,
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

  // Enhance a user-entered prompt using the current selected model
  handle(
    "prompt:enhance",
    async (_e: IpcMainInvokeEvent, payload: { text: string }): Promise<string> => {
      const { text } = payload || { text: "" };
      if (!text || !text.trim()) return text;

      // For E2E tests, short-circuit to avoid network calls
      if (IS_TEST_BUILD) {
        return `[enhanced] ${text.trim()}`;
      }

      const settings = readSettings();
      const { modelClient, isEngineEnabled } = await getModelClient(
        settings.selectedModel,
        settings,
      );

      // Clear, production-grade enhancement prompt focusing on actionable, concise improvements.
      const systemPrompt = `You are a professional AI coding assistant. Improve the user's prompt so the model can take high-quality, actionable steps.

Rewrite the prompt to:
- Make the goal explicit and outcome-driven.
- Include key constraints (platform, framework, libraries, versions) if implied.
- Extract hidden requirements, edge cases, and acceptance criteria succinctly.
- Keep it concise, imperative, and unambiguous.
- Preserve user intent; do NOT change the task.
- Output ONLY the improved prompt (no preface, no bullets, no commentary).`;

      // Build messages. If engine is enabled, the engine will handle context smartly; otherwise this is plain LLM call.
      const messages = [
        { role: "system" as const, content: systemPrompt },
        { role: "user" as const, content: text },
      ];

      const providerOptions: Record<string, any> = isEngineEnabled
        ? { "dyad-engine": { dyadDisableFiles: true } }
        : {};

      const { fullStream } = await streamText({
        model: modelClient.model,
        messages,
        maxRetries: 1,
        temperature: 0.2,
        providerOptions,
      });

      let enhanced = "";
      for await (const part of fullStream as AsyncIterable<TextStreamPart<ToolSet>>) {
        if (part.type === "text-delta") {
          enhanced += part.text;
        }
      }
      // Safety clamp
      return (enhanced || text).trim();
    },
  );
}
