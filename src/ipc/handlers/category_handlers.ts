import { db } from "@/db";
import { apps, categories } from "@/db/schema";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { categoryContracts } from "../types/categories";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

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

function isUniqueNameError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  return message.includes("UNIQUE constraint failed: categories.name");
}

export function registerCategoryHandlers() {
  createTypedHandler(categoryContracts.list, async () => {
    const rows = db.select().from(categories).orderBy(categories.name).all();
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
      throw new DyadError(
        "Category name is required",
        DyadErrorKind.Validation,
      );
    }

    let id: number;
    try {
      id = db.transaction((tx) => {
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
    } catch (error) {
      if (isUniqueNameError(error)) {
        throw new DyadError(
          "A category with that name already exists",
          DyadErrorKind.Conflict,
        );
      }
      throw error;
    }

    const row = db.select().from(categories).where(eq(categories.id, id)).get();
    if (!row) {
      throw new DyadError(
        "Failed to fetch created category",
        DyadErrorKind.Internal,
      );
    }
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
    const { id, name, appIds } = params;
    const trimmed = name.trim();
    if (!trimmed) {
      throw new DyadError(
        "Category name is required",
        DyadErrorKind.Validation,
      );
    }
    try {
      db.transaction((tx) => {
        tx.update(categories)
          .set({ name: trimmed, updatedAt: new Date() })
          .where(eq(categories.id, id))
          .run();
        if (appIds) {
          const existing = tx
            .select({ id: apps.id })
            .from(apps)
            .where(eq(apps.categoryId, id))
            .all();
          const before = new Set(existing.map((a) => a.id));
          const after = new Set(appIds);
          const toAdd = appIds.filter((appId) => !before.has(appId));
          const toRemove = existing
            .map((a) => a.id)
            .filter((appId) => !after.has(appId));
          if (toAdd.length > 0) {
            tx.update(apps)
              .set({ categoryId: id })
              .where(inArray(apps.id, toAdd))
              .run();
          }
          if (toRemove.length > 0) {
            tx.update(apps)
              .set({ categoryId: null })
              .where(inArray(apps.id, toRemove))
              .run();
          }
        }
      });
    } catch (error) {
      if (isUniqueNameError(error)) {
        throw new DyadError(
          "A category with that name already exists",
          DyadErrorKind.Conflict,
        );
      }
      throw error;
    }
  });

  createTypedHandler(categoryContracts.delete, async (_, id) => {
    // ON DELETE SET NULL on apps.category_id handles this at the DB level,
    // but we null out explicitly first so the operation is robust regardless
    // of whether foreign_keys pragma is enabled in the current connection.
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
