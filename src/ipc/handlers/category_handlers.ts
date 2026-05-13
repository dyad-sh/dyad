import log from "electron-log";
import { db } from "@/db";
import { apps, categories } from "@/db/schema";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { categoryContracts } from "../types/categories";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const _logger = log.scope("category_handlers");

function buildCategoryDto(
  row: {
    id: number;
    name: string;
    createdAt: Date;
    updatedAt: Date;
  },
  appIds: number[],
) {
  return {
    id: row.id,
    name: row.name,
    appIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function registerCategoryHandlers() {
  createTypedHandler(categoryContracts.list, async () => {
    const rows = db.select().from(categories).all();
    const appRows = db
      .select({ id: apps.id, categoryId: apps.categoryId })
      .from(apps)
      .where(isNotNull(apps.categoryId))
      .all();
    const appsByCategory = new Map<number, number[]>();
    for (const row of appRows) {
      if (row.categoryId == null) continue;
      const list = appsByCategory.get(row.categoryId) ?? [];
      list.push(row.id);
      appsByCategory.set(row.categoryId, list);
    }
    return rows.map((r) => buildCategoryDto(r, appsByCategory.get(r.id) ?? []));
  });

  createTypedHandler(categoryContracts.create, async (_, params) => {
    const { name, appIds } = params;
    const trimmed = name.trim();
    if (!trimmed) {
      throw new DyadError("Category name is required", DyadErrorKind.External);
    }

    const id = db.transaction((tx) => {
      const insertResult = tx
        .insert(categories)
        .values({ name: trimmed })
        .run();
      const newId = Number(insertResult.lastInsertRowid);
      if (appIds && appIds.length > 0) {
        tx.update(apps)
          .set({ categoryId: newId })
          .where(inArray(apps.id, appIds))
          .run();
      }
      return newId;
    });

    const row = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!row) throw new Error("Failed to fetch created category");
    const memberAppRows = db
      .select({ id: apps.id })
      .from(apps)
      .where(eq(apps.categoryId, id))
      .all();
    return buildCategoryDto(
      row,
      memberAppRows.map((a) => a.id),
    );
  });

  createTypedHandler(categoryContracts.update, async (_, params) => {
    const { id, name } = params;
    const trimmed = name.trim();
    if (!trimmed) {
      throw new DyadError("Category name is required", DyadErrorKind.External);
    }
    db.update(categories)
      .set({ name: trimmed, updatedAt: new Date() })
      .where(eq(categories.id, id))
      .run();
  });

  createTypedHandler(categoryContracts.delete, async (_, id) => {
    db.transaction((tx) => {
      tx.update(apps)
        .set({ categoryId: null })
        .where(eq(apps.categoryId, id))
        .run();
      tx.delete(categories).where(eq(categories.id, id)).run();
    });
  });

  createTypedHandler(categoryContracts.assignApps, async (_, params) => {
    const { categoryId, appIds } = params;
    if (appIds.length === 0) return;
    db.update(apps).set({ categoryId }).where(inArray(apps.id, appIds)).run();
  });
}
