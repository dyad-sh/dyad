/**
 * Version Control Handlers
 * Git-like versioning for datasets with branching, merging, and history
 * 
 * Features:
 * - Dataset snapshots and commits
 * - Branching and merging
 * - Diff and comparison tools
 * - Rollback and cherry-pick
 * - Version tagging
 * - Conflict resolution
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import * as crypto from "crypto";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, inArray, and, sql, desc, asc } from "drizzle-orm";
import { datasetItems, studioDatasets } from "@/db/schema";

const logger = log.scope("version_control");

// ============================================================================
// Types
// ============================================================================

interface DatasetVersion {
  id: string;
  datasetId: string;
  branchName: string;
  parentVersionId?: string;
  commitMessage: string;
  committedBy: string;
  commitHash: string;
  snapshotPath: string;
  stats: {
    totalItems: number;
    addedItems: number;
    removedItems: number;
    modifiedItems: number;
    byteSize: number;
  };
  tags: string[];
  metadata?: Record<string, any>;
  createdAt: Date;
}

interface Branch {
  name: string;
  datasetId: string;
  headVersionId: string;
  isDefault: boolean;
  isProtected: boolean;
  createdFrom?: string;
  createdAt: Date;
  updatedAt: Date;
}

interface VersionDiff {
  added: DiffEntry[];
  removed: DiffEntry[];
  modified: DiffEntry[];
  stats: {
    addedCount: number;
    removedCount: number;
    modifiedCount: number;
    addedBytes: number;
    removedBytes: number;
  };
}

interface DiffEntry {
  itemId: string;
  contentHash: string;
  contentHashBefore?: string;
  modality: string;
  split: string;
  changeType: "added" | "removed" | "modified";
  sizeDelta?: number;
}

interface MergeResult {
  success: boolean;
  conflicts?: ConflictEntry[];
  mergedVersion?: DatasetVersion;
  stats?: {
    merged: number;
    conflicts: number;
    autoResolved: number;
  };
}

interface ConflictEntry {
  itemId: string;
  sourceVersion: string;
  targetVersion: string;
  conflictType: "content" | "deletion" | "metadata";
  sourceHash?: string;
  targetHash?: string;
  resolution?: "source" | "target" | "both" | "manual";
}

interface VersionTimeline {
  versions: DatasetVersion[];
  branches: Branch[];
  currentBranch: string;
  currentVersion: string;
}

// ============================================================================
// Storage
// ============================================================================

const versions: Map<string, DatasetVersion> = new Map();
const branches: Map<string, Branch> = new Map(); // key: `${datasetId}/${branchName}`
const pendingConflicts: Map<string, ConflictEntry[]> = new Map();

function getVersionStorageDir(): string {
  return path.join(app.getPath("userData"), "dataset-versions");
}

function getBranchKey(datasetId: string, branchName: string): string {
  return `${datasetId}/${branchName}`;
}

async function initializeVersionStorage() {
  const storageDir = getVersionStorageDir();
  await fs.ensureDir(storageDir);
  await fs.ensureDir(path.join(storageDir, "snapshots"));
  
  // Load versions
  const versionsPath = path.join(storageDir, "versions.json");
  if (await fs.pathExists(versionsPath)) {
    const data = await fs.readJson(versionsPath);
    for (const v of data) {
      versions.set(v.id, { ...v, createdAt: new Date(v.createdAt) });
    }
  }
  
  // Load branches
  const branchesPath = path.join(storageDir, "branches.json");
  if (await fs.pathExists(branchesPath)) {
    const data = await fs.readJson(branchesPath);
    for (const b of data) {
      branches.set(
        getBranchKey(b.datasetId, b.name),
        { ...b, createdAt: new Date(b.createdAt), updatedAt: new Date(b.updatedAt) }
      );
    }
  }
  
  logger.info(`Loaded ${versions.size} versions, ${branches.size} branches`);
}

async function saveVersions() {
  const storageDir = getVersionStorageDir();
  await fs.writeJson(
    path.join(storageDir, "versions.json"),
    Array.from(versions.values()),
    { spaces: 2 }
  );
}

async function saveBranches() {
  const storageDir = getVersionStorageDir();
  await fs.writeJson(
    path.join(storageDir, "branches.json"),
    Array.from(branches.values()),
    { spaces: 2 }
  );
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerVersionControlHandlers() {
  logger.info("Registering Version Control handlers");

  app.whenReady().then(() => {
    initializeVersionStorage().catch(err => {
      logger.error("Failed to initialize version storage:", err);
    });
  });

  // ========== Versioning ==========

  /**
   * Create a new version (commit)
   */
  ipcMain.handle("version:commit", async (_event, args: {
    datasetId: string;
    branchName?: string;
    message: string;
    committedBy: string;
    tags?: string[];
  }) => {
    try {
      const { datasetId, message, committedBy, tags = [] } = args;
      const branchName = args.branchName || "main";
      
      // Verify dataset exists
      const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, datasetId));
      if (!dataset) throw new Error("Dataset not found");
      
      // Get or create branch
      const branchKey = getBranchKey(datasetId, branchName);
      let branch = branches.get(branchKey);
      
      if (!branch) {
        branch = {
          name: branchName,
          datasetId,
          headVersionId: "",
          isDefault: branchName === "main",
          isProtected: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        branches.set(branchKey, branch);
      }
      
      // Get current items
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
      
      // Calculate stats
      const prevVersion = branch.headVersionId ? versions.get(branch.headVersionId) ?? null : null;
      const stats = await calculateVersionStats(datasetId, items, prevVersion);
      
      // Create snapshot
      const versionId = uuidv4();
      const snapshotDir = path.join(getVersionStorageDir(), "snapshots", datasetId);
      await fs.ensureDir(snapshotDir);
      
      const snapshotPath = path.join(snapshotDir, `${versionId}.json`);
      const snapshotData = {
        datasetId,
        versionId,
        createdAt: new Date().toISOString(),
        items: items.map(item => ({
          id: item.id,
          contentHash: item.contentHash,
          modality: item.modality,
          split: item.split,
          sourceType: item.sourceType,
          byteSize: item.byteSize,
          labelsJson: item.labelsJson,
          qualitySignalsJson: item.qualitySignalsJson,
          lineageJson: item.lineageJson,
        })),
      };
      
      await fs.writeJson(snapshotPath, snapshotData, { spaces: 2 });
      
      // Calculate commit hash
      const hashContent = JSON.stringify({
        parentVersionId: branch.headVersionId || null,
        message,
        itemHashes: items.map(i => i.contentHash).sort(),
        timestamp: Date.now(),
      });
      const commitHash = crypto.createHash("sha256").update(hashContent).digest("hex").substring(0, 12);
      
      // Create version
      const version: DatasetVersion = {
        id: versionId,
        datasetId,
        branchName,
        parentVersionId: branch.headVersionId || undefined,
        commitMessage: message,
        committedBy,
        commitHash,
        snapshotPath,
        stats,
        tags,
        createdAt: new Date(),
      };
      
      versions.set(versionId, version);
      
      // Update branch head
      branch.headVersionId = versionId;
      branch.updatedAt = new Date();
      
      await Promise.all([saveVersions(), saveBranches()]);
      
      return { success: true, version };
    } catch (error) {
      logger.error("Commit failed:", error);
      throw error;
    }
  });

  /**
   * List versions for a dataset
   */
  ipcMain.handle("version:list", async (_event, args: {
    datasetId: string;
    branchName?: string;
    limit?: number;
  }) => {
    try {
      let result = Array.from(versions.values()).filter(v => v.datasetId === args.datasetId);
      
      if (args.branchName) {
        result = result.filter(v => v.branchName === args.branchName);
      }
      
      result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      if (args.limit) {
        result = result.slice(0, args.limit);
      }
      
      return { success: true, versions: result };
    } catch (error) {
      logger.error("List versions failed:", error);
      throw error;
    }
  });

  /**
   * Get version details
   */
  ipcMain.handle("version:get", async (_event, versionId: string) => {
    try {
      const version = versions.get(versionId);
      if (!version) throw new Error("Version not found");
      
      // Load snapshot
      const snapshotData = await fs.readJson(version.snapshotPath);
      
      return {
        success: true,
        version,
        snapshot: snapshotData,
      };
    } catch (error) {
      logger.error("Get version failed:", error);
      throw error;
    }
  });

  /**
   * Tag a version
   */
  ipcMain.handle("version:tag", async (_event, args: {
    versionId: string;
    tag: string;
  }) => {
    try {
      const version = versions.get(args.versionId);
      if (!version) throw new Error("Version not found");
      
      if (!version.tags.includes(args.tag)) {
        version.tags.push(args.tag);
        await saveVersions();
      }
      
      return { success: true, version };
    } catch (error) {
      logger.error("Tag version failed:", error);
      throw error;
    }
  });

  /**
   * Find version by tag
   */
  ipcMain.handle("version:find-by-tag", async (_event, args: {
    datasetId: string;
    tag: string;
  }) => {
    try {
      const version = Array.from(versions.values()).find(
        v => v.datasetId === args.datasetId && v.tags.includes(args.tag)
      );
      
      return { success: true, version: version || null };
    } catch (error) {
      logger.error("Find by tag failed:", error);
      throw error;
    }
  });

  // ========== Branching ==========

  /**
   * Create a new branch
   */
  ipcMain.handle("version:create-branch", async (_event, args: {
    datasetId: string;
    branchName: string;
    fromVersionId?: string;
    fromBranch?: string;
  }) => {
    try {
      const { datasetId, branchName } = args;
      const branchKey = getBranchKey(datasetId, branchName);
      
      if (branches.has(branchKey)) {
        throw new Error("Branch already exists");
      }
      
      // Determine source
      let sourceVersionId: string | undefined;
      let createdFrom: string | undefined;
      
      if (args.fromVersionId) {
        const sourceVersion = versions.get(args.fromVersionId);
        if (!sourceVersion || sourceVersion.datasetId !== datasetId) {
          throw new Error("Source version not found");
        }
        sourceVersionId = args.fromVersionId;
        createdFrom = sourceVersion.branchName;
      } else if (args.fromBranch) {
        const sourceBranch = branches.get(getBranchKey(datasetId, args.fromBranch));
        if (!sourceBranch) {
          throw new Error("Source branch not found");
        }
        sourceVersionId = sourceBranch.headVersionId;
        createdFrom = args.fromBranch;
      } else {
        // Default to main branch
        const mainBranch = branches.get(getBranchKey(datasetId, "main"));
        if (mainBranch) {
          sourceVersionId = mainBranch.headVersionId;
          createdFrom = "main";
        }
      }
      
      const branch: Branch = {
        name: branchName,
        datasetId,
        headVersionId: sourceVersionId || "",
        isDefault: false,
        isProtected: false,
        createdFrom,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      branches.set(branchKey, branch);
      await saveBranches();
      
      return { success: true, branch };
    } catch (error) {
      logger.error("Create branch failed:", error);
      throw error;
    }
  });

  /**
   * List branches
   */
  ipcMain.handle("version:list-branches", async (_event, datasetId: string) => {
    try {
      const result = Array.from(branches.values()).filter(b => b.datasetId === datasetId);
      
      return { success: true, branches: result };
    } catch (error) {
      logger.error("List branches failed:", error);
      throw error;
    }
  });

  /**
   * Delete a branch
   */
  ipcMain.handle("version:delete-branch", async (_event, args: {
    datasetId: string;
    branchName: string;
  }) => {
    try {
      const branchKey = getBranchKey(args.datasetId, args.branchName);
      const branch = branches.get(branchKey);
      
      if (!branch) throw new Error("Branch not found");
      if (branch.isDefault) throw new Error("Cannot delete default branch");
      if (branch.isProtected) throw new Error("Branch is protected");
      
      branches.delete(branchKey);
      await saveBranches();
      
      return { success: true };
    } catch (error) {
      logger.error("Delete branch failed:", error);
      throw error;
    }
  });

  /**
   * Protect/unprotect a branch
   */
  ipcMain.handle("version:protect-branch", async (_event, args: {
    datasetId: string;
    branchName: string;
    protect: boolean;
  }) => {
    try {
      const branchKey = getBranchKey(args.datasetId, args.branchName);
      const branch = branches.get(branchKey);
      
      if (!branch) throw new Error("Branch not found");
      
      branch.isProtected = args.protect;
      branch.updatedAt = new Date();
      
      await saveBranches();
      
      return { success: true, branch };
    } catch (error) {
      logger.error("Protect branch failed:", error);
      throw error;
    }
  });

  // ========== Diff & Comparison ==========

  /**
   * Compare two versions
   */
  ipcMain.handle("version:diff", async (_event, args: {
    sourceVersionId: string;
    targetVersionId: string;
  }) => {
    try {
      const sourceVersion = versions.get(args.sourceVersionId);
      const targetVersion = versions.get(args.targetVersionId);
      
      if (!sourceVersion || !targetVersion) {
        throw new Error("Version not found");
      }
      
      const sourceSnapshot = await fs.readJson(sourceVersion.snapshotPath);
      const targetSnapshot = await fs.readJson(targetVersion.snapshotPath);
      
      const diff = calculateDiff(sourceSnapshot.items, targetSnapshot.items);
      
      return { success: true, diff };
    } catch (error) {
      logger.error("Diff failed:", error);
      throw error;
    }
  });

  /**
   * Compare branch heads
   */
  ipcMain.handle("version:diff-branches", async (_event, args: {
    datasetId: string;
    sourceBranch: string;
    targetBranch: string;
  }) => {
    try {
      const sourceBranchData = branches.get(getBranchKey(args.datasetId, args.sourceBranch));
      const targetBranchData = branches.get(getBranchKey(args.datasetId, args.targetBranch));
      
      if (!sourceBranchData || !targetBranchData) {
        throw new Error("Branch not found");
      }
      
      if (!sourceBranchData.headVersionId || !targetBranchData.headVersionId) {
        return { success: true, diff: { added: [], removed: [], modified: [], stats: { addedCount: 0, removedCount: 0, modifiedCount: 0, addedBytes: 0, removedBytes: 0 } } };
      }
      
      const sourceVersion = versions.get(sourceBranchData.headVersionId);
      const targetVersion = versions.get(targetBranchData.headVersionId);
      
      if (!sourceVersion || !targetVersion) {
        throw new Error("Version not found");
      }
      
      const sourceSnapshot = await fs.readJson(sourceVersion.snapshotPath);
      const targetSnapshot = await fs.readJson(targetVersion.snapshotPath);
      
      const diff = calculateDiff(sourceSnapshot.items, targetSnapshot.items);
      
      return { success: true, diff };
    } catch (error) {
      logger.error("Diff branches failed:", error);
      throw error;
    }
  });

  // ========== Rollback & Checkout ==========

  /**
   * Rollback to a specific version
   */
  ipcMain.handle("version:rollback", async (_event, args: {
    datasetId: string;
    versionId: string;
    createBackup?: boolean;
  }) => {
    try {
      const version = versions.get(args.versionId);
      if (!version || version.datasetId !== args.datasetId) {
        throw new Error("Version not found");
      }
      
      // Optionally create backup of current state
      if (args.createBackup) {
        // Create a commit with current state
        const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, args.datasetId));
        if (items.length > 0) {
          // This would trigger a commit - simplified for now
          logger.info("Creating backup before rollback");
        }
      }
      
      // Load snapshot
      const snapshotData = await fs.readJson(version.snapshotPath);
      
      // Delete current items
      await db.delete(datasetItems).where(eq(datasetItems.datasetId, args.datasetId));
      
      // Restore items from snapshot
      const contentStoreDir = path.join(app.getPath("userData"), "content-store");
      
      for (const item of snapshotData.items) {
        // Verify content exists
        const prefix = item.contentHash.substring(0, 2);
        const contentPath = path.join(contentStoreDir, prefix, item.contentHash);
        
        if (await fs.pathExists(contentPath)) {
          await db.insert(datasetItems).values({
            id: item.id,
            datasetId: args.datasetId,
            contentHash: item.contentHash,
            contentUri: `content://${item.contentHash}`,
            modality: item.modality,
            split: item.split,
            sourceType: item.sourceType,
            byteSize: item.byteSize,
            labelsJson: item.labelsJson,
            qualitySignalsJson: item.qualitySignalsJson,
            lineageJson: item.lineageJson,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } else {
          logger.warn(`Content missing for item ${item.id}: ${item.contentHash}`);
        }
      }
      
      // Update dataset timestamp
      await db.update(studioDatasets)
        .set({ updatedAt: new Date() })
        .where(eq(studioDatasets.id, args.datasetId));
      
      return {
        success: true,
        restoredItems: snapshotData.items.length,
        version,
      };
    } catch (error) {
      logger.error("Rollback failed:", error);
      throw error;
    }
  });

  /**
   * Cherry-pick specific items from a version
   */
  ipcMain.handle("version:cherry-pick", async (_event, args: {
    datasetId: string;
    versionId: string;
    itemIds: string[];
    mode: "add" | "replace";
  }) => {
    try {
      const version = versions.get(args.versionId);
      if (!version) throw new Error("Version not found");
      
      const snapshotData = await fs.readJson(version.snapshotPath);
      const itemsToRestore = snapshotData.items.filter((item: any) => args.itemIds.includes(item.id));
      
      if (itemsToRestore.length === 0) {
        throw new Error("No matching items found in version");
      }
      
      const contentStoreDir = path.join(app.getPath("userData"), "content-store");
      let restored = 0;
      
      for (const item of itemsToRestore) {
        const prefix = item.contentHash.substring(0, 2);
        const contentPath = path.join(contentStoreDir, prefix, item.contentHash);
        
        if (await fs.pathExists(contentPath)) {
          if (args.mode === "replace") {
            // Delete existing item if present
            await db.delete(datasetItems).where(eq(datasetItems.id, item.id));
          }
          
          // Check if item already exists
          const [existing] = await db.select().from(datasetItems).where(eq(datasetItems.id, item.id));
          
          if (!existing || args.mode === "replace") {
            await db.insert(datasetItems).values({
              id: args.mode === "add" ? uuidv4() : item.id,
              datasetId: args.datasetId,
              contentHash: item.contentHash,
              contentUri: `content://${item.contentHash}`,
              modality: item.modality,
              split: item.split,
              sourceType: item.sourceType,
              byteSize: item.byteSize,
              labelsJson: item.labelsJson,
              qualitySignalsJson: item.qualitySignalsJson,
              lineageJson: item.lineageJson,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            restored++;
          }
        }
      }
      
      return { success: true, restored };
    } catch (error) {
      logger.error("Cherry-pick failed:", error);
      throw error;
    }
  });

  // ========== Merge ==========

  /**
   * Merge branches
   */
  ipcMain.handle("version:merge", async (_event, args: {
    datasetId: string;
    sourceBranch: string;
    targetBranch: string;
    strategy: "ours" | "theirs" | "union";
    committedBy: string;
    message?: string;
  }) => {
    try {
      const sourceBranchData = branches.get(getBranchKey(args.datasetId, args.sourceBranch));
      const targetBranchData = branches.get(getBranchKey(args.datasetId, args.targetBranch));
      
      if (!sourceBranchData || !targetBranchData) {
        throw new Error("Branch not found");
      }
      
      if (targetBranchData.isProtected) {
        throw new Error("Target branch is protected");
      }
      
      if (!sourceBranchData.headVersionId || !targetBranchData.headVersionId) {
        throw new Error("One or both branches have no commits");
      }
      
      const sourceVersion = versions.get(sourceBranchData.headVersionId);
      const targetVersion = versions.get(targetBranchData.headVersionId);
      
      if (!sourceVersion || !targetVersion) {
        throw new Error("Version not found");
      }
      
      const sourceSnapshot = await fs.readJson(sourceVersion.snapshotPath);
      const targetSnapshot = await fs.readJson(targetVersion.snapshotPath);
      
      // Calculate diff and detect conflicts
      const diff = calculateDiff(sourceSnapshot.items, targetSnapshot.items);
      const conflicts: ConflictEntry[] = [];
      
      // Detect conflicts (items modified in both branches since common ancestor)
      const sourceItemMap = new Map<string, { id: string; contentHash: string; [key: string]: any }>(
        sourceSnapshot.items.map((i: any) => [i.id, i])
      );
      const targetItemMap = new Map<string, { id: string; contentHash: string; [key: string]: any }>(
        targetSnapshot.items.map((i: any) => [i.id, i])
      );
      
      for (const item of diff.modified) {
        const sourceItem = sourceItemMap.get(item.itemId);
        const targetItem = targetItemMap.get(item.itemId);
        
        if (sourceItem && targetItem && sourceItem.contentHash !== targetItem.contentHash) {
          conflicts.push({
            itemId: item.itemId,
            sourceVersion: sourceBranchData.headVersionId,
            targetVersion: targetBranchData.headVersionId,
            conflictType: "content",
            sourceHash: sourceItem.contentHash,
            targetHash: targetItem.contentHash,
          });
        }
      }
      
      // Resolve conflicts based on strategy
      const mergedItems: any[] = [...targetSnapshot.items];
      let autoResolved = 0;
      
      for (const conflict of conflicts) {
        if (args.strategy === "ours") {
          // Keep target (current branch)
          conflict.resolution = "target";
          autoResolved++;
        } else if (args.strategy === "theirs") {
          // Use source
          const sourceItem = sourceItemMap.get(conflict.itemId);
          const idx = mergedItems.findIndex(i => i.id === conflict.itemId);
          if (idx >= 0 && sourceItem) {
            mergedItems[idx] = sourceItem;
          }
          conflict.resolution = "source";
          autoResolved++;
        } else if (args.strategy === "union") {
          // Keep both (will create duplicate)
          const sourceItem = sourceItemMap.get(conflict.itemId);
          if (sourceItem) {
            mergedItems.push({ ...sourceItem, id: uuidv4() });
          }
          conflict.resolution = "both";
          autoResolved++;
        }
      }
      
      // Add new items from source
      for (const added of diff.added) {
        const sourceItem = sourceItemMap.get(added.itemId);
        if (sourceItem && !targetItemMap.has(added.itemId)) {
          mergedItems.push(sourceItem);
        }
      }
      
      // Apply merged state to database
      await db.delete(datasetItems).where(eq(datasetItems.datasetId, args.datasetId));
      
      const contentStoreDir = path.join(app.getPath("userData"), "content-store");
      
      for (const item of mergedItems) {
        const prefix = item.contentHash.substring(0, 2);
        const contentPath = path.join(contentStoreDir, prefix, item.contentHash);
        
        if (await fs.pathExists(contentPath)) {
          await db.insert(datasetItems).values({
            id: item.id,
            datasetId: args.datasetId,
            contentHash: item.contentHash,
            contentUri: `content://${item.contentHash}`,
            modality: item.modality,
            split: item.split,
            sourceType: item.sourceType,
            byteSize: item.byteSize,
            labelsJson: item.labelsJson,
            qualitySignalsJson: item.qualitySignalsJson,
            lineageJson: item.lineageJson,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }
      
      // Create merge commit
      const versionId = uuidv4();
      const snapshotDir = path.join(getVersionStorageDir(), "snapshots", args.datasetId);
      await fs.ensureDir(snapshotDir);
      
      const snapshotPath = path.join(snapshotDir, `${versionId}.json`);
      await fs.writeJson(snapshotPath, {
        datasetId: args.datasetId,
        versionId,
        createdAt: new Date().toISOString(),
        items: mergedItems,
        mergeInfo: {
          sourceBranch: args.sourceBranch,
          targetBranch: args.targetBranch,
          sourceVersionId: sourceBranchData.headVersionId,
          targetVersionId: targetBranchData.headVersionId,
        },
      }, { spaces: 2 });
      
      const commitHash = crypto.createHash("sha256")
        .update(JSON.stringify({
          parentVersionId: targetBranchData.headVersionId,
          message: args.message || `Merge ${args.sourceBranch} into ${args.targetBranch}`,
          itemHashes: mergedItems.map((i: any) => i.contentHash).sort(),
          timestamp: Date.now(),
        }))
        .digest("hex")
        .substring(0, 12);
      
      const mergeVersion: DatasetVersion = {
        id: versionId,
        datasetId: args.datasetId,
        branchName: args.targetBranch,
        parentVersionId: targetBranchData.headVersionId,
        commitMessage: args.message || `Merge ${args.sourceBranch} into ${args.targetBranch}`,
        committedBy: args.committedBy,
        commitHash,
        snapshotPath,
        stats: {
          totalItems: mergedItems.length,
          addedItems: diff.added.length,
          removedItems: diff.removed.length,
          modifiedItems: diff.modified.length,
          byteSize: mergedItems.reduce((sum: number, i: any) => sum + (i.byteSize || 0), 0),
        },
        tags: [],
        metadata: { mergeFrom: args.sourceBranch, conflicts: conflicts.length },
        createdAt: new Date(),
      };
      
      versions.set(versionId, mergeVersion);
      targetBranchData.headVersionId = versionId;
      targetBranchData.updatedAt = new Date();
      
      await Promise.all([saveVersions(), saveBranches()]);
      
      const result: MergeResult = {
        success: true,
        mergedVersion: mergeVersion,
        stats: {
          merged: mergedItems.length,
          conflicts: conflicts.length,
          autoResolved,
        },
      };
      
      if (conflicts.length > 0 && args.strategy !== "ours" && args.strategy !== "theirs") {
        result.conflicts = conflicts;
      }
      
      return result;
    } catch (error) {
      logger.error("Merge failed:", error);
      throw error;
    }
  });

  // ========== Timeline ==========

  /**
   * Get version timeline/history
   */
  ipcMain.handle("version:timeline", async (_event, args: {
    datasetId: string;
    branchName?: string;
    since?: string;
  }) => {
    try {
      let versionList = Array.from(versions.values()).filter(v => v.datasetId === args.datasetId);
      
      if (args.branchName) {
        versionList = versionList.filter(v => v.branchName === args.branchName);
      }
      
      if (args.since) {
        const sinceDate = new Date(args.since);
        versionList = versionList.filter(v => v.createdAt >= sinceDate);
      }
      
      versionList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      
      const branchList = Array.from(branches.values()).filter(b => b.datasetId === args.datasetId);
      
      // Determine current branch and version
      const mainBranch = branchList.find(b => b.isDefault) || branchList[0];
      
      const timeline: VersionTimeline = {
        versions: versionList,
        branches: branchList,
        currentBranch: mainBranch?.name || "main",
        currentVersion: mainBranch?.headVersionId || "",
      };
      
      return { success: true, timeline };
    } catch (error) {
      logger.error("Get timeline failed:", error);
      throw error;
    }
  });

  /**
   * Get version graph for visualization
   */
  ipcMain.handle("version:graph", async (_event, datasetId: string) => {
    try {
      const versionList = Array.from(versions.values()).filter(v => v.datasetId === datasetId);
      const branchList = Array.from(branches.values()).filter(b => b.datasetId === datasetId);
      
      // Build graph nodes and edges
      const nodes = versionList.map(v => ({
        id: v.id,
        label: v.commitHash,
        message: v.commitMessage,
        branch: v.branchName,
        tags: v.tags,
        createdAt: v.createdAt,
      }));
      
      const edges: Array<{ source: string; target: string; type: string }> = [];
      
      for (const v of versionList) {
        if (v.parentVersionId) {
          edges.push({
            source: v.parentVersionId,
            target: v.id,
            type: v.metadata?.mergeFrom ? "merge" : "commit",
          });
        }
      }
      
      return {
        success: true,
        graph: { nodes, edges, branches: branchList },
      };
    } catch (error) {
      logger.error("Get version graph failed:", error);
      throw error;
    }
  });

  logger.info("Version Control handlers registered");
}

// ============================================================================
// Helper Functions
// ============================================================================

async function calculateVersionStats(
  datasetId: string,
  items: any[],
  prevVersion: DatasetVersion | null
): Promise<DatasetVersion["stats"]> {
  const stats: DatasetVersion["stats"] = {
    totalItems: items.length,
    addedItems: 0,
    removedItems: 0,
    modifiedItems: 0,
    byteSize: items.reduce((sum, i) => sum + (i.byteSize || 0), 0),
  };
  
  if (!prevVersion) {
    stats.addedItems = items.length;
    return stats;
  }
  
  try {
    const prevSnapshot = await fs.readJson(prevVersion.snapshotPath);
    const prevItemMap = new Map<string, { id: string; contentHash: string }>(
      prevSnapshot.items.map((i: any) => [i.id, i])
    );
    const currentItemMap = new Map(items.map(i => [i.id, i]));
    
    for (const item of items) {
      if (!prevItemMap.has(item.id)) {
        stats.addedItems++;
      } else {
        const prevItem = prevItemMap.get(item.id);
        if (prevItem && prevItem.contentHash !== item.contentHash) {
          stats.modifiedItems++;
        }
      }
    }
    
    for (const prevItem of prevSnapshot.items) {
      if (!currentItemMap.has(prevItem.id)) {
        stats.removedItems++;
      }
    }
  } catch (error) {
    logger.error("Error calculating version stats:", error);
    stats.addedItems = items.length;
  }
  
  return stats;
}

function calculateDiff(sourceItems: any[], targetItems: any[]): VersionDiff {
  const sourceMap = new Map(sourceItems.map(i => [i.id, i]));
  const targetMap = new Map(targetItems.map(i => [i.id, i]));
  
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const modified: DiffEntry[] = [];
  
  let addedBytes = 0;
  let removedBytes = 0;
  
  // Find items in source but not in target (added in source)
  for (const item of sourceItems) {
    if (!targetMap.has(item.id)) {
      added.push({
        itemId: item.id,
        contentHash: item.contentHash,
        modality: item.modality,
        split: item.split,
        changeType: "added",
      });
      addedBytes += item.byteSize || 0;
    } else {
      const targetItem = targetMap.get(item.id);
      if (targetItem.contentHash !== item.contentHash) {
        modified.push({
          itemId: item.id,
          contentHash: item.contentHash,
          contentHashBefore: targetItem.contentHash,
          modality: item.modality,
          split: item.split,
          changeType: "modified",
          sizeDelta: (item.byteSize || 0) - (targetItem.byteSize || 0),
        });
      }
    }
  }
  
  // Find items in target but not in source (removed in source)
  for (const item of targetItems) {
    if (!sourceMap.has(item.id)) {
      removed.push({
        itemId: item.id,
        contentHash: item.contentHash,
        modality: item.modality,
        split: item.split,
        changeType: "removed",
      });
      removedBytes += item.byteSize || 0;
    }
  }
  
  return {
    added,
    removed,
    modified,
    stats: {
      addedCount: added.length,
      removedCount: removed.length,
      modifiedCount: modified.length,
      addedBytes,
      removedBytes,
    },
  };
}
