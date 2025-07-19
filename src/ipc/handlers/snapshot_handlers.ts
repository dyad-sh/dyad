import { ipcMain } from "electron";
import { db } from "../../db";
import { snapshots } from "../../db/schema";
import { desc, eq } from "drizzle-orm";
import type {
  Snapshot,
  CreateSnapshotParams,
  ListSnapshotsParams,
  DeleteSnapshotParams,
} from "../ipc_types";

// List snapshots for an app
ipcMain.handle(
  "list-snapshots",
  async (event, params: ListSnapshotsParams): Promise<Snapshot[]> => {
    try {
      const result = await db.query.snapshots.findMany({
        where: eq(snapshots.appId, params.appId),
        orderBy: desc(snapshots.createdAt),
      });

      return result.map((snapshot) => ({
        id: snapshot.id,
        appId: snapshot.appId,
        commitHash: snapshot.commitHash,
        dbTimestamp: snapshot.dbTimestamp,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
      }));
    } catch (error) {
      console.error("Error listing snapshots:", error);
      throw new Error(
        `Failed to list snapshots: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },
);

// Create a new snapshot
ipcMain.handle(
  "create-snapshot",
  async (event, params: CreateSnapshotParams): Promise<Snapshot> => {
    try {
      const [newSnapshot] = await db
        .insert(snapshots)
        .values({
          appId: params.appId,
          commitHash: params.commitHash,
          dbTimestamp: params.dbTimestamp || null,
        })
        .returning();

      return {
        id: newSnapshot.id,
        appId: newSnapshot.appId,
        commitHash: newSnapshot.commitHash,
        dbTimestamp: newSnapshot.dbTimestamp,
        createdAt: newSnapshot.createdAt,
        updatedAt: newSnapshot.updatedAt,
      };
    } catch (error) {
      console.error("Error creating snapshot:", error);
      throw new Error(
        `Failed to create snapshot: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },
);

// Delete a snapshot
ipcMain.handle(
  "delete-snapshot",
  async (event, params: DeleteSnapshotParams): Promise<void> => {
    try {
      const result = await db
        .delete(snapshots)
        .where(eq(snapshots.id, params.snapshotId));

      if (result.changes === 0) {
        throw new Error("Snapshot not found");
      }
    } catch (error) {
      console.error("Error deleting snapshot:", error);
      throw new Error(
        `Failed to delete snapshot: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },
);

export function registerSnapshotHandlers() {
  // Handlers are registered above when this module is imported
}
