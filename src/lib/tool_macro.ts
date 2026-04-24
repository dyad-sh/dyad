/**
 * Tool Macros
 *
 * A macro is a named sequence of tool invocations. When invoked, the steps
 * run in order; the JSON-stringified output of each step is available to
 * subsequent steps via simple template substitution: `{{step1}}`, `{{step2}}`.
 *
 * This is the mechanism for the swarm to "learn new tools" without code:
 * when an agent successfully solves a recurring problem, it can record the
 * winning sequence as a macro that future agents will see in their tool list.
 */

import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import log from "electron-log";

const logger = log.scope("tool_macro");

export type MacroId = string & { __brand: "MacroId" };

export interface MacroStep {
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToolMacro {
  id: MacroId;
  name: string;
  description: string;
  steps: MacroStep[];
  ownerId: string;
  createdAt: number;
  updatedAt: number;
}

export type ToolDispatcher = (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

class ToolMacroStore {
  private db: Database.Database | null = null;
  private dir: string;

  constructor() {
    this.dir = path.join(app.getPath("userData"), "tool-macros");
  }

  async initialize(): Promise<void> {
    if (this.db) return;
    await fs.mkdir(this.dir, { recursive: true });
    this.db = new Database(path.join(this.dir, "macros.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS macros (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        steps TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    logger.info("Tool macro store initialized");
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("Tool macro store not initialized");
    return this.db;
  }

  create(params: { name: string; description?: string; steps: MacroStep[]; ownerId: string }): ToolMacro {
    if (!params.steps.length) throw new Error("Macro must have at least one step");
    const db = this.requireDb();
    const now = Date.now();
    const macro: ToolMacro = {
      id: randomUUID() as MacroId,
      name: params.name,
      description: params.description ?? "",
      steps: params.steps,
      ownerId: params.ownerId,
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(
      `INSERT INTO macros (id, name, description, steps, owner_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      macro.id,
      macro.name,
      macro.description,
      JSON.stringify(macro.steps),
      macro.ownerId,
      macro.createdAt,
      macro.updatedAt,
    );
    return macro;
  }

  list(): ToolMacro[] {
    return (this.requireDb().prepare("SELECT * FROM macros ORDER BY name").all() as Array<
      Record<string, unknown>
    >).map(this.rowToMacro);
  }

  getByName(name: string): ToolMacro | null {
    const row = this.requireDb().prepare("SELECT * FROM macros WHERE name = ?").get(name) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToMacro(row) : null;
  }

  remove(id: MacroId): void {
    const r = this.requireDb().prepare("DELETE FROM macros WHERE id = ?").run(id);
    if (r.changes === 0) throw new Error(`Macro not found: ${id}`);
  }

  /**
   * Run a macro. Each step's stringified result is captured so subsequent
   * step args can reference it via the template `{{stepN}}` (1-indexed).
   */
  async execute(name: string, dispatcher: ToolDispatcher): Promise<string[]> {
    const macro = this.getByName(name);
    if (!macro) throw new Error(`Macro not found: ${name}`);
    const outputs: string[] = [];
    for (let i = 0; i < macro.steps.length; i++) {
      const step = macro.steps[i];
      const args = substitute(step.args, outputs);
      const result = await dispatcher(step.toolName, args);
      outputs.push(typeof result === "string" ? result : JSON.stringify(result ?? null));
    }
    return outputs;
  }

  private rowToMacro = (row: Record<string, unknown>): ToolMacro => ({
    id: String(row.id) as MacroId,
    name: String(row.name),
    description: String(row.description ?? ""),
    steps: JSON.parse(String(row.steps ?? "[]")),
    ownerId: String(row.owner_id),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  });
}

function substitute(value: unknown, outputs: string[]): Record<string, unknown> {
  const json = JSON.stringify(value);
  const replaced = json.replace(/\{\{step(\d+)\}\}/g, (_match, n: string) => {
    const idx = Number.parseInt(n, 10) - 1;
    if (idx < 0 || idx >= outputs.length) return "";
    // JSON-escape the substituted value
    return outputs[idx].replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  });
  return JSON.parse(replaced) as Record<string, unknown>;
}

let _instance: ToolMacroStore | null = null;
export function getToolMacroStore(): ToolMacroStore {
  if (!_instance) _instance = new ToolMacroStore();
  return _instance;
}
