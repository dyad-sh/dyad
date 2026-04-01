// =============================================================================
// Library IPC Handlers — Personal file bookshelf with decentralized storage
// =============================================================================

import { IpcMainInvokeEvent, dialog, BrowserWindow } from "electron";
import log from "electron-log";
import path from "node:path";
import crypto from "node:crypto";
import * as fs from "fs-extra";
import { eq, like, and } from "drizzle-orm";
import { db } from "@/db";
import { libraryItems } from "@/db/schema";
import { getUserDataPath } from "@/paths/paths";
import { createLoggedHandler } from "./safe_handle";

const logger = log.scope("library-handlers");
const handle = createLoggedHandler(logger);

function getLibraryStorePath(): string {
  return path.join(getUserDataPath(), "library-store");
}

async function hashFile(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function hashBuffer(buffer: Buffer): Promise<string> {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function storeFileLocally(
  sourcePathOrBuffer: string | Buffer,
  contentHash: string,
): Promise<string> {
  const prefix = contentHash.slice(0, 2);
  const storePath = path.join(getLibraryStorePath(), prefix, contentHash);
  await fs.ensureDir(path.dirname(storePath));

  if (typeof sourcePathOrBuffer === "string") {
    await fs.copy(sourcePathOrBuffer, storePath, { overwrite: false });
  } else {
    if (!(await fs.pathExists(storePath))) {
      await fs.writeFile(storePath, sourcePathOrBuffer);
    }
  }
  return storePath;
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".xml": "application/xml",
    ".html": "text/html",
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx":
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx":
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".zip": "application/zip",
    ".gz": "application/gzip",
    ".tar": "application/x-tar",
    ".epub": "application/epub+zip",
  };
  return mimeMap[ext] || "application/octet-stream";
}

export function registerLibraryHandlers() {
  logger.log("Registering Library handlers...");

  // ---- Upload via file dialog ----
  handle(
    "library:upload-dialog",
    async (event: IpcMainInvokeEvent) => {
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window) throw new Error("No window found");

      const result = await dialog.showOpenDialog(window, {
        properties: ["openFile", "multiSelections"],
        title: "Add Files to Library",
        filters: [
          { name: "All Files", extensions: ["*"] },
          {
            name: "Documents",
            extensions: [
              "pdf",
              "doc",
              "docx",
              "xls",
              "xlsx",
              "ppt",
              "pptx",
              "epub",
            ],
          },
          {
            name: "Text",
            extensions: ["txt", "md", "csv", "json", "xml", "html"],
          },
          {
            name: "Images",
            extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp"],
          },
          {
            name: "Audio",
            extensions: ["mp3", "wav", "ogg", "flac"],
          },
          {
            name: "Video",
            extensions: ["mp4", "webm", "mkv", "avi"],
          },
        ],
      });

      if (result.canceled || result.filePaths.length === 0) return [];

      const items = [];
      for (const filePath of result.filePaths) {
        const stat = await fs.stat(filePath);
        const contentHash = await hashFile(filePath);

        // Dedup: check if hash already exists
        const existing = db
          .select()
          .from(libraryItems)
          .where(eq(libraryItems.contentHash, contentHash))
          .get();

        if (existing) {
          items.push(existing);
          continue;
        }

        const storagePath = await storeFileLocally(filePath, contentHash);
        const mimeType = getMimeType(filePath);

        const inserted = db
          .insert(libraryItems)
          .values({
            name: path.basename(filePath),
            mimeType,
            byteSize: stat.size,
            contentHash,
            storagePath,
            storageTier: "local",
          })
          .run();

        const row = db
          .select()
          .from(libraryItems)
          .where(eq(libraryItems.id, Number(inserted.lastInsertRowid)))
          .get();

        if (row) items.push(row);
      }
      return items;
    },
  );

  // ---- Import from base64 buffer (drag-and-drop) ----
  handle(
    "library:import-buffer",
    async (
      _: IpcMainInvokeEvent,
      params: { name: string; base64: string; mimeType?: string },
    ) => {
      if (!params.name || !params.base64) {
        throw new Error("Name and base64 data are required");
      }

      const buffer = Buffer.from(params.base64, "base64");
      const contentHash = await hashBuffer(buffer);

      // Dedup
      const existing = db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.contentHash, contentHash))
        .get();

      if (existing) return existing;

      const storagePath = await storeFileLocally(buffer, contentHash);
      const mimeType = params.mimeType || getMimeType(params.name);

      const inserted = db
        .insert(libraryItems)
        .values({
          name: params.name,
          mimeType,
          byteSize: buffer.length,
          contentHash,
          storagePath,
          storageTier: "local",
        })
        .run();

      const row = db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.id, Number(inserted.lastInsertRowid)))
        .get();

      if (!row) throw new Error("Failed to create library item");
      return row;
    },
  );

  // ---- List items with optional filters ----
  handle(
    "library:list",
    async (
      _: IpcMainInvokeEvent,
      filters?: {
        storageTier?: string;
        mimeType?: string;
        search?: string;
        category?: string;
      },
    ) => {
      const conditions = [];

      if (filters?.storageTier) {
        conditions.push(eq(libraryItems.storageTier, filters.storageTier));
      }
      if (filters?.mimeType) {
        conditions.push(like(libraryItems.mimeType, `${filters.mimeType}%`));
      }
      if (filters?.search) {
        conditions.push(like(libraryItems.name, `%${filters.search}%`));
      }
      if (filters?.category) {
        conditions.push(eq(libraryItems.category, filters.category));
      }

      const query = db.select().from(libraryItems);

      if (conditions.length > 0) {
        return query.where(and(...conditions)).all();
      }
      return query.all();
    },
  );

  // ---- Get single item ----
  handle("library:get", async (_: IpcMainInvokeEvent, id: number) => {
    if (!id) throw new Error("Item ID is required");
    const row = db
      .select()
      .from(libraryItems)
      .where(eq(libraryItems.id, id))
      .get();
    if (!row) throw new Error(`Library item not found: ${id}`);
    return row;
  });

  // ---- Get file content as base64 ----
  handle(
    "library:get-content",
    async (_: IpcMainInvokeEvent, id: number) => {
      if (!id) throw new Error("Item ID is required");
      const row = db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.id, id))
        .get();
      if (!row) throw new Error(`Library item not found: ${id}`);

      const data = await fs.readFile(row.storagePath);
      return data.toString("base64");
    },
  );

  // ---- Update metadata ----
  handle(
    "library:update",
    async (
      _: IpcMainInvokeEvent,
      params: {
        id: number;
        name?: string;
        description?: string;
        tags?: string[];
        category?: string;
      },
    ) => {
      if (!params.id) throw new Error("Item ID is required");

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (params.name !== undefined) updates.name = params.name;
      if (params.description !== undefined)
        updates.description = params.description;
      if (params.tags !== undefined) updates.tags = params.tags;
      if (params.category !== undefined) updates.category = params.category;

      db.update(libraryItems)
        .set(updates)
        .where(eq(libraryItems.id, params.id))
        .run();

      const row = db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.id, params.id))
        .get();
      if (!row) throw new Error(`Library item not found: ${params.id}`);
      return row;
    },
  );

  // ---- Delete item ----
  handle(
    "library:delete",
    async (_: IpcMainInvokeEvent, id: number) => {
      if (!id) throw new Error("Item ID is required");
      const row = db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.id, id))
        .get();
      if (!row) throw new Error(`Library item not found: ${id}`);

      // Remove file from disk
      if (await fs.pathExists(row.storagePath)) {
        await fs.remove(row.storagePath);
      }

      db.delete(libraryItems).where(eq(libraryItems.id, id)).run();
    },
  );

  // ---- Store to IPFS (short-term via Helia) ----
  handle(
    "library:store-to-ipfs",
    async (_: IpcMainInvokeEvent, id: number) => {
      if (!id) throw new Error("Item ID is required");
      const row = db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.id, id))
        .get();
      if (!row) throw new Error(`Library item not found: ${id}`);

      const { heliaVerificationService } = await import("../../lib/helia_verification_service");
      const result = await heliaVerificationService.storeModelChunkFile(
        row.storagePath,
      );

      db.update(libraryItems)
        .set({
          storageTier: "ipfs",
          cid: result.cid,
          updatedAt: new Date(),
        })
        .where(eq(libraryItems.id, id))
        .run();

      return {
        cid: result.cid,
        bytes: result.bytes,
      };
    },
  );

  // ---- Pin to remote IPFS (medium-term via 4everland/Pinata) ----
  handle(
    "library:pin-to-remote",
    async (_: IpcMainInvokeEvent, id: number) => {
      if (!id) throw new Error("Item ID is required");
      const row = db
        .select()
        .from(libraryItems)
        .where(eq(libraryItems.id, id))
        .get();
      if (!row) throw new Error(`Library item not found: ${id}`);

      if (!row.cid) {
        throw new Error(
          "File must be stored on IPFS first before remote pinning",
        );
      }

      const { receiptPinningService } = await import("../../lib/receipt_pinning_service");
      const pinResult = await receiptPinningService.pinTo4everland(
        row.cid,
        row.name,
      );

      if (!pinResult.success) {
        throw new Error(
          pinResult.error || "Failed to pin to remote IPFS service",
        );
      }

      db.update(libraryItems)
        .set({
          storageTier: "ipfs_pinned",
          pinned: true,
          updatedAt: new Date(),
        })
        .where(eq(libraryItems.id, id))
        .run();

      return {
        cid: row.cid,
        gateway: pinResult.gateway,
        provider: pinResult.provider,
      };
    },
  );

  // ---- Store to Arweave (permanent — stubbed) ----
  handle(
    "library:store-to-arweave",
    async (_: IpcMainInvokeEvent, id: number) => {
      if (!id) throw new Error("Item ID is required");
      throw new Error(
        "Arweave storage is not yet configured. Add your Arweave wallet in Settings to enable permanent storage.",
      );
    },
  );

  // ---- Store to Filecoin (long-term — stubbed) ----
  handle(
    "library:store-to-filecoin",
    async (_: IpcMainInvokeEvent, id: number) => {
      if (!id) throw new Error("Item ID is required");
      throw new Error(
        "Filecoin storage is not yet configured. Add your Filecoin wallet in Settings to enable long-term storage.",
      );
    },
  );

  logger.log("Library handlers registered");
}
