import { ipcMain } from "electron";
import { db } from "../../db";
import { favorites, apps, snapshots } from "../../db/schema";
import { desc, eq } from "drizzle-orm";
import type {
  Favorite,
  CreateFavoriteParams,
  ListFavoritesParams,
  DeleteFavoriteParams,
} from "../ipc_types";
import { getNeonClient } from "../../neon_admin/neon_management_client";
import { EndpointType } from "@neondatabase/api-client";

// List favorites for an app
ipcMain.handle(
  "list-favorites",
  async (event, params: ListFavoritesParams): Promise<Favorite[]> => {
    try {
      const result = await db.query.favorites.findMany({
        where: eq(favorites.appId, params.appId),
        orderBy: desc(favorites.createdAt),
      });

      return result.map((favorite) => ({
        id: favorite.id,
        appId: favorite.appId,
        commitHash: favorite.commitHash,
        neonBranchId: favorite.neonBranchId,
        createdAt: favorite.createdAt,
        updatedAt: favorite.updatedAt,
      }));
    } catch (error) {
      console.error("Error listing favorites:", error);
      throw new Error(
        `Failed to list favorites: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },
);

// Create a new favorite
ipcMain.handle(
  "create-favorite",
  async (event, params: CreateFavoriteParams): Promise<Favorite> => {
    try {
      // Get the app data to check if it has a neon project
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, params.appId),
      });

      if (!app) {
        throw new Error("App not found");
      }

      let neonBranchId: string | null = null;

      // If the app has a neon project, create a branch
      if (app.neonProjectId && app.neonBranchId) {
        try {
          const snapshot = await db.query.snapshots.findFirst({
            where: eq(snapshots.appId, params.appId),
            orderBy: desc(snapshots.createdAt),
          });

          const snapshotTimestamp = snapshot?.dbTimestamp;
          // MAKE SURE if dbTimestamp is null, that this is the latest snapshot
          // Otherwise, something weird is happening
          if (snapshot && snapshotTimestamp === null) {
            // If the latest snapshot has null dbTimestamp, verify this is actually the newest snapshot
            // by checking if there are any snapshots with non-null dbTimestamp that are newer
            const allRecentSnapshots = await db.query.snapshots.findMany({
              where: eq(snapshots.appId, params.appId),
              orderBy: desc(snapshots.createdAt),
              limit: 10, // Check recent snapshots for data consistency
            });

            // Find the newest snapshot with non-null dbTimestamp
            const newestSnapshotWithTimestamp = allRecentSnapshots.find(
              (s) => s.dbTimestamp !== null,
            );

            if (
              newestSnapshotWithTimestamp &&
              newestSnapshotWithTimestamp.createdAt > snapshot.createdAt
            ) {
              throw new Error(
                `Data inconsistency detected for app ${params.appId}. ` +
                  `Latest snapshot (${snapshot.createdAt}) has null dbTimestamp, but there's a newer snapshot ` +
                  `(${newestSnapshotWithTimestamp.createdAt}) with non-null dbTimestamp. This shouldn't happen.`,
              );
            }
          }

          const neonClient = await getNeonClient();

          // Generate a unique branch name using commit hash
          const branchName = `favorite-${params.commitHash.substring(0, 8)}`;

          // Create the Neon branch
          const branchResponse = await neonClient.createProjectBranch(
            app.neonProjectId,
            {
              endpoints: [{ type: EndpointType.ReadWrite }],
              branch: {
                parent_id: app.neonBranchId,
                parent_lsn: snapshotTimestamp ?? undefined,
                name: branchName,
              },
            },
          );

          if (!branchResponse.data.branch) {
            throw new Error(
              "Failed to create branch: No branch data returned.",
            );
          }

          neonBranchId = branchResponse.data.branch.id;
        } catch (error) {
          console.error("Error creating Neon branch:", error);
          throw new Error(
            "Could not create Neon database branch, favorite is not saved. Please remove an existing favorite.",
          );
        }
      }

      // Create the favorite record
      const [newFavorite] = await db
        .insert(favorites)
        .values({
          appId: params.appId,
          commitHash: params.commitHash,
          neonBranchId: neonBranchId,
        })
        .returning();

      return {
        id: newFavorite.id,
        appId: newFavorite.appId,
        commitHash: newFavorite.commitHash,
        neonBranchId: newFavorite.neonBranchId,
        createdAt: newFavorite.createdAt,
        updatedAt: newFavorite.updatedAt,
      };
    } catch (error) {
      console.error("Error creating favorite:", error);
      throw new Error(
        `Failed to create favorite: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },
);

// Delete a favorite
ipcMain.handle(
  "delete-favorite",
  async (event, params: DeleteFavoriteParams): Promise<void> => {
    try {
      // First, get the favorite record to check if it has a neonBranchId
      const favorite = await db.query.favorites.findFirst({
        where: eq(favorites.id, params.favoriteId),
        with: {
          app: true, // Include app data to get neonProjectId
        },
      });

      if (!favorite) {
        throw new Error("Favorite not found");
      }

      // If the favorite has a neon branch, delete it
      if (favorite.neonBranchId && favorite.app.neonProjectId) {
        try {
          const neonClient = await getNeonClient();

          // Delete the Neon branch
          await neonClient.deleteProjectBranch(
            favorite.app.neonProjectId,
            favorite.neonBranchId,
          );

          console.log(
            `Successfully deleted Neon branch: ${favorite.neonBranchId}`,
          );
        } catch (error) {
          console.error("Error deleting Neon branch:", error);
          // Log the error but don't fail the favorite deletion
          // The branch might already be deleted or the project might not exist
          console.warn(
            `Failed to delete Neon branch ${favorite.neonBranchId}, but continuing with favorite deletion`,
          );
        }
      }

      // Delete the favorite record from the database
      const result = await db
        .delete(favorites)
        .where(eq(favorites.id, params.favoriteId));

      if (result.changes === 0) {
        throw new Error("Favorite not found");
      }
    } catch (error) {
      console.error("Error deleting favorite:", error);
      throw new Error(
        `Failed to delete favorite: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  },
);

export function registerFavoritesHandlers() {
  // Handlers are registered above when this module is imported
}
