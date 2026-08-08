/**
 * Todo persistence utilities.
 *
 * Reads/writes per-chat todo JSON files so that todos survive across turns.
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { AgentTodoSchema } from "@/ipc/types";
import type { Todo } from "./tools/types";

const logger = log.scope("todo_persistence");

/**
 * Return the path to the todos JSON file for a given chat.
 *
 * Layout: `<appPath>/.dyad/todos/<chatId>.json`
 */
export function getTodosFilePath(appPath: string, chatId: number): string {
  return path.join(appPath, ".dyad", "todos", `${chatId}.json`);
}

/**
 * Persist the current todos list to disk.
 *
 * Creates the `.dyad/todos/` directory if it does not exist.
 */
export async function saveTodos(
  appPath: string,
  chatId: number,
  todos: Todo[],
): Promise<void> {
  const filePath = getTodosFilePath(appPath, chatId);
  try {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const data = JSON.stringify(
      { todos, updatedAt: new Date().toISOString() },
      null,
      2,
    );
    await fs.promises.writeFile(filePath, data, "utf-8");
  } catch (err) {
    logger.warn("Failed to save todos:", err);
  }
}

/**
 * Load previously persisted todos for a chat.
 *
 * Returns `[]` if the file does not exist or is corrupted.
 */
export async function loadTodos(
  appPath: string,
  chatId: number,
): Promise<Todo[]> {
  const filePath = getTodosFilePath(appPath, chatId);
  try {
    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.todos)) {
      // Validate each todo entry to guard against corrupted/hand-edited files
      const validated = parsed.todos.flatMap((t: unknown) => {
        const result = AgentTodoSchema.safeParse(t);
        return result.success ? [result.data] : [];
      });
      return validated;
    }
    logger.warn("Unexpected todos file format, returning empty list");
    return [];
  } catch (err: any) {
    // ENOENT just means no todos have been saved for this chat yet.
    if (err?.code === "ENOENT") {
      return [];
    }
    logger.warn("Failed to load todos, returning empty list:", err);
    return [];
  }
}

/**
 * Delete the todos file for a chat (e.g. when all todos are completed).
 */
export async function deleteTodos(
  appPath: string,
  chatId: number,
): Promise<void> {
  const filePath = getTodosFilePath(appPath, chatId);
  try {
    await fs.promises.unlink(filePath);
  } catch (err) {
    // ENOENT is fine — the file may not exist if no todos were ever persisted,
    // or parallel tool executions in the same step may race on deletion.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.warn("Failed to delete todos file:", err);
    }
  }
}
