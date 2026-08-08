import log from "electron-log";

import { writeSettings } from "@/main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import { vercelBlobContracts } from "../types/vercel_blob";
import {
  createBlobFolder,
  deleteBlob,
  deleteBlobFolder,
  getBlobDataUrl,
  isBlobConnected,
  listBlobs,
  renameBlob,
  renameBlobFolder,
  uploadToBlob,
  verifyBlobToken,
} from "../utils/vercel_blob";

const logger = log.scope("vercel_blob_handlers");

export function registerVercelBlobHandlers() {
  createTypedHandler(vercelBlobContracts.status, async () => ({
    connected: isBlobConnected(),
  }));

  createTypedHandler(vercelBlobContracts.connect, async (_, { token }) => {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new DyadError("A Blob token is required.", DyadErrorKind.External);
    }
    try {
      await verifyBlobToken(trimmed);
    } catch (e) {
      throw new DyadError(
        `Could not connect to Vercel Blob — ${
          e instanceof Error ? e.message : String(e)
        }. Check the BLOB_READ_WRITE_TOKEN is correct.`,
        DyadErrorKind.External,
      );
    }
    writeSettings({
      vercelBlob: { token: { value: trimmed }, connectedAt: Date.now() },
    });
    logger.log("Connected Vercel Blob store");
    return { connected: true };
  });

  createTypedHandler(vercelBlobContracts.disconnect, async () => {
    writeSettings({ vercelBlob: {} });
    logger.log("Disconnected Vercel Blob store");
    return { connected: false };
  });

  createTypedHandler(vercelBlobContracts.list, async () => listBlobs());

  createTypedHandler(
    vercelBlobContracts.upload,
    async (_, { pathname, dataBase64, contentType }) => {
      const buffer = Buffer.from(dataBase64, "base64");
      return uploadToBlob(pathname, buffer, {
        contentType,
        allowOverwrite: true,
      });
    },
  );

  createTypedHandler(vercelBlobContracts.createFolder, async (_, folder) => {
    await createBlobFolder(folder);
  });

  createTypedHandler(
    vercelBlobContracts.renameFolder,
    async (_, { from, to }) => {
      await renameBlobFolder(from, to);
    },
  );

  createTypedHandler(vercelBlobContracts.deleteFolder, async (_, prefix) => {
    await deleteBlobFolder(prefix);
  });

  createTypedHandler(vercelBlobContracts.delete, async (_, url) => {
    await deleteBlob(url);
  });

  createTypedHandler(vercelBlobContracts.getDataUrl, async (_, url) =>
    getBlobDataUrl(url),
  );

  createTypedHandler(
    vercelBlobContracts.renameFile,
    async (_, { fromUrl, toPathname }) => renameBlob(fromUrl, toPathname),
  );
}
