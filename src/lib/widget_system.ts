/**
 * Widget System
 *
 * A widget is a small, self-contained UI surface that can be pinned to the
 * user's dashboard or any container view. Widgets are typically contributed
 * by plugins (via PluginManifest.contributes.views) but agents can also
 * dynamically create live widgets to display the result of long-running work
 * (charts, status cards, alerts).
 *
 * Storage: dedicated SQLite DB under userData/widgets/widgets.db so this
 * subsystem can ship without app-level Drizzle migrations.
 */

import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { EventEmitter } from "node:events";
import log from "electron-log";

const logger = log.scope("widget_system");

export type WidgetId = string & { __brand: "WidgetId" };
export type WidgetKind = "card" | "chart" | "list" | "iframe" | "custom";

export interface Widget {
  id: WidgetId;
  kind: WidgetKind;
  title: string;
  /** Renderer component path (for plugin-contributed views) or null. */
  component: string | null;
  /** Arbitrary props passed to the renderer component. */
  props: Record<string, unknown>;
  /** Container/route the widget is pinned to (e.g. "dashboard"). */
  container: string;
  /** Display order within the container. */
  position: number;
  /** Plugin or agent that created the widget. */
  ownerId: string;
  ownerKind: "plugin" | "agent" | "user";
  createdAt: number;
  updatedAt: number;
}

export interface CreateWidgetParams {
  kind: WidgetKind;
  title: string;
  component?: string | null;
  props?: Record<string, unknown>;
  container?: string;
  ownerId: string;
  ownerKind: Widget["ownerKind"];
}

export class WidgetSystem extends EventEmitter {
  private db: Database.Database | null = null;
  private dir: string;

  constructor() {
    super();
    this.dir = path.join(app.getPath("userData"), "widgets");
  }

  async initialize(): Promise<void> {
    if (this.db) return;
    await fs.mkdir(this.dir, { recursive: true });
    this.db = new Database(path.join(this.dir, "widgets.db"));
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS widgets (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        component TEXT,
        props TEXT NOT NULL DEFAULT '{}',
        container TEXT NOT NULL DEFAULT 'dashboard',
        position INTEGER NOT NULL DEFAULT 0,
        owner_id TEXT NOT NULL,
        owner_kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS widgets_container_idx ON widgets(container, position);
    `);
    logger.info("Widget system initialized");
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error("Widget system not initialized");
    return this.db;
  }

  create(params: CreateWidgetParams): Widget {
    const db = this.requireDb();
    const now = Date.now();
    const id = randomUUID() as WidgetId;
    const container = params.container ?? "dashboard";
    const positionRow = db
      .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM widgets WHERE container = ?")
      .get(container) as { p: number };
    const widget: Widget = {
      id,
      kind: params.kind,
      title: params.title,
      component: params.component ?? null,
      props: params.props ?? {},
      container,
      position: positionRow.p,
      ownerId: params.ownerId,
      ownerKind: params.ownerKind,
      createdAt: now,
      updatedAt: now,
    };
    db.prepare(
      `INSERT INTO widgets (id, kind, title, component, props, container, position, owner_id, owner_kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      widget.id,
      widget.kind,
      widget.title,
      widget.component,
      JSON.stringify(widget.props),
      widget.container,
      widget.position,
      widget.ownerId,
      widget.ownerKind,
      widget.createdAt,
      widget.updatedAt,
    );
    this.emit("widget:created", widget);
    return widget;
  }

  list(container?: string): Widget[] {
    const db = this.requireDb();
    const rows = container
      ? db.prepare("SELECT * FROM widgets WHERE container = ? ORDER BY position ASC").all(container)
      : db.prepare("SELECT * FROM widgets ORDER BY container, position").all();
    return (rows as Array<Record<string, unknown>>).map(this.rowToWidget);
  }

  get(id: WidgetId): Widget | null {
    const row = this.requireDb().prepare("SELECT * FROM widgets WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToWidget(row) : null;
  }

  update(id: WidgetId, patch: Partial<Pick<Widget, "title" | "props" | "position" | "container">>): Widget {
    const db = this.requireDb();
    const existing = this.get(id);
    if (!existing) throw new Error(`Widget not found: ${id}`);
    const next: Widget = {
      ...existing,
      ...patch,
      props: patch.props ?? existing.props,
      updatedAt: Date.now(),
    };
    db.prepare(
      `UPDATE widgets SET title = ?, props = ?, position = ?, container = ?, updated_at = ? WHERE id = ?`,
    ).run(next.title, JSON.stringify(next.props), next.position, next.container, next.updatedAt, id);
    this.emit("widget:updated", next);
    return next;
  }

  remove(id: WidgetId): void {
    const result = this.requireDb().prepare("DELETE FROM widgets WHERE id = ?").run(id);
    if (result.changes === 0) throw new Error(`Widget not found: ${id}`);
    this.emit("widget:removed", id);
  }

  private rowToWidget = (row: Record<string, unknown>): Widget => {
    let props: Record<string, unknown> = {};
    try {
      props = JSON.parse(String(row.props ?? "{}"));
    } catch {
      props = {};
    }
    return {
      id: String(row.id) as WidgetId,
      kind: String(row.kind) as WidgetKind,
      title: String(row.title),
      component: row.component == null ? null : String(row.component),
      props,
      container: String(row.container),
      position: Number(row.position),
      ownerId: String(row.owner_id),
      ownerKind: String(row.owner_kind) as Widget["ownerKind"],
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    };
  };
}

let _instance: WidgetSystem | null = null;
export function getWidgetSystem(): WidgetSystem {
  if (!_instance) _instance = new WidgetSystem();
  return _instance;
}
