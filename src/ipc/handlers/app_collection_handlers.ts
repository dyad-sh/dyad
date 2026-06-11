import { apps, appCollections } from "@/db/schema";
import { eq, inArray, isNotNull } from "drizzle-orm";
import { createTypedHandler } from "./base";
import { getHandlerContext } from "./handler_context";
import { appCollectionContracts } from "../types/app_collections";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

function buildAppCollectionDto(
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
  return message.includes("UNIQUE constraint failed: app_collections.name");
}

export function registerAppCollectionHandlers() {
  createTypedHandler(appCollectionContracts.list, async () => {
    const { db } = getHandlerContext();
    const rows = db
      .select()
      .from(appCollections)
      .orderBy(appCollections.name)
      .all();
    const appRows = db
      .select({ id: apps.id, collectionId: apps.collectionId })
      .from(apps)
      .where(isNotNull(apps.collectionId))
      .all();
    const appsByCollection = new Map<number, number[]>();
    for (const row of appRows) {
      if (row.collectionId == null) continue;
      const list = appsByCollection.get(row.collectionId) ?? [];
      list.push(row.id);
      appsByCollection.set(row.collectionId, list);
    }
    return rows.map((r) =>
      buildAppCollectionDto(r, appsByCollection.get(r.id) ?? []),
    );
  });

  createTypedHandler(appCollectionContracts.create, async (_, params) => {
    const { db } = getHandlerContext();
    const { name, appIds } = params;
    const trimmed = name.trim();
    if (!trimmed) {
      throw new DyadError(
        "Collection name is required",
        DyadErrorKind.Validation,
      );
    }

    let id: number;
    try {
      id = db.transaction((tx) => {
        const insertResult = tx
          .insert(appCollections)
          .values({ name: trimmed })
          .run();
        const newId = Number(insertResult.lastInsertRowid);
        if (appIds && appIds.length > 0) {
          tx.update(apps)
            .set({ collectionId: newId })
            .where(inArray(apps.id, appIds))
            .run();
        }
        return newId;
      });
    } catch (error) {
      if (isUniqueNameError(error)) {
        throw new DyadError(
          "A collection with that name already exists",
          DyadErrorKind.Conflict,
        );
      }
      throw error;
    }

    const row = db
      .select()
      .from(appCollections)
      .where(eq(appCollections.id, id))
      .get();
    if (!row) {
      throw new DyadError(
        "Failed to fetch created collection",
        DyadErrorKind.Internal,
      );
    }
    const memberAppRows = db
      .select({ id: apps.id })
      .from(apps)
      .where(eq(apps.collectionId, id))
      .all();
    return buildAppCollectionDto(
      row,
      memberAppRows.map((a) => a.id),
    );
  });

  createTypedHandler(appCollectionContracts.update, async (_, params) => {
    const { db } = getHandlerContext();
    const { id, name, appIds } = params;
    const trimmed = name.trim();
    if (!trimmed) {
      throw new DyadError(
        "Collection name is required",
        DyadErrorKind.Validation,
      );
    }
    try {
      db.transaction((tx) => {
        const existingCollection = tx
          .select({ id: appCollections.id })
          .from(appCollections)
          .where(eq(appCollections.id, id))
          .get();
        if (!existingCollection) {
          throw new DyadError("Collection not found", DyadErrorKind.NotFound);
        }
        tx.update(appCollections)
          .set({ name: trimmed, updatedAt: new Date() })
          .where(eq(appCollections.id, id))
          .run();
        if (appIds) {
          const existing = tx
            .select({ id: apps.id })
            .from(apps)
            .where(eq(apps.collectionId, id))
            .all();
          const before = new Set(existing.map((a) => a.id));
          const after = new Set(appIds);
          const toAdd = appIds.filter((appId) => !before.has(appId));
          const toRemove = existing
            .map((a) => a.id)
            .filter((appId) => !after.has(appId));
          if (toAdd.length > 0) {
            tx.update(apps)
              .set({ collectionId: id })
              .where(inArray(apps.id, toAdd))
              .run();
          }
          if (toRemove.length > 0) {
            tx.update(apps)
              .set({ collectionId: null })
              .where(inArray(apps.id, toRemove))
              .run();
          }
        }
      });
    } catch (error) {
      if (isUniqueNameError(error)) {
        throw new DyadError(
          "A collection with that name already exists",
          DyadErrorKind.Conflict,
        );
      }
      throw error;
    }
  });

  createTypedHandler(appCollectionContracts.delete, async (_, id) => {
    const { db } = getHandlerContext();
    // ON DELETE SET NULL on apps.collection_id handles this at the DB level,
    // but we null out explicitly first so the operation is robust regardless
    // of whether foreign_keys pragma is enabled in the current connection.
    db.transaction((tx) => {
      const existingCollection = tx
        .select({ id: appCollections.id })
        .from(appCollections)
        .where(eq(appCollections.id, id))
        .get();
      if (!existingCollection) {
        throw new DyadError("Collection not found", DyadErrorKind.NotFound);
      }
      tx.update(apps)
        .set({ collectionId: null })
        .where(eq(apps.collectionId, id))
        .run();
      tx.delete(appCollections).where(eq(appCollections.id, id)).run();
    });
  });

  createTypedHandler(appCollectionContracts.assignApps, async (_, params) => {
    const { db } = getHandlerContext();
    const { collectionId, appIds } = params;
    if (appIds.length === 0) return;
    db.transaction((tx) => {
      if (collectionId != null) {
        const existingCollection = tx
          .select({ id: appCollections.id })
          .from(appCollections)
          .where(eq(appCollections.id, collectionId))
          .get();
        if (!existingCollection) {
          throw new DyadError("Collection not found", DyadErrorKind.NotFound);
        }
      }
      tx.update(apps)
        .set({ collectionId })
        .where(inArray(apps.id, appIds))
        .run();
    });
  });
}
