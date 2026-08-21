import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { ChatAgentStartParams } from "@/ipc/types/chat_agent";
import { readSettings } from "@/main/settings";
import { blobVaultKey } from "../blob_vault";
import { buildVaultMediaUrl } from "../vault_media";
import { uploadToBlob } from "../vercel_blob";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const RECORD_IMAGE_FOLDER = "Media/Images/Records";

const EXTENSION_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
} as const;

export type PersistedDataSourceAttachment = {
  originalName: string;
  storageUrl: string;
  storageKey: string;
  mimeType: keyof typeof EXTENSION_BY_MIME;
  sha256: string;
  sizeBytes: number;
};

function safeBaseName(name: string): string {
  const base = path.basename(name, path.extname(name));
  return (
    base
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "image"
  );
}

function decodeAttachment(
  attachment: NonNullable<ChatAgentStartParams["attachments"]>[number],
): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(attachment.dataBase64)) {
    throw new DyadError(
      `Could not read attached image "${attachment.name}".`,
      DyadErrorKind.Validation,
    );
  }
  const data = Buffer.from(attachment.dataBase64, "base64");
  if (data.length === 0 || data.length > MAX_ATTACHMENT_BYTES) {
    throw new DyadError(
      `Attached image "${attachment.name}" must be smaller than 10 MB.`,
      DyadErrorKind.Validation,
    );
  }
  return data;
}

/**
 * Stores attached database evidence before the model can reference it.
 * Returned paths are therefore facts, not model-authored placeholders.
 */
export async function persistDataSourceAttachments(
  attachments: ChatAgentStartParams["attachments"],
): Promise<PersistedDataSourceAttachment[]> {
  if (!attachments?.length) return [];

  const storage = readSettings().storage;
  const storageDestination =
    storage?.destination ?? (storage?.localVaultPath?.trim() ? "local" : null);
  if (!storageDestination) {
    throw new DyadError(
      "Choose a storage destination in Settings → Storage before attaching an image to a data-source record.",
      DyadErrorKind.Precondition,
    );
  }

  return Promise.all(
    attachments.map(async (attachment) => {
      const data = decodeAttachment(attachment);
      const mimeType = attachment.mimeType;
      const fileName = `${safeBaseName(attachment.name)}-${crypto.randomUUID()}${EXTENSION_BY_MIME[mimeType]}`;
      const relativePath = `${RECORD_IMAGE_FOLDER}/${fileName}`;
      const sha256 = crypto.createHash("sha256").update(data).digest("hex");

      if (storageDestination === "cloud") {
        try {
          const uploaded = await uploadToBlob(
            blobVaultKey(relativePath),
            data,
            {
              contentType: mimeType,
            },
          );
          return {
            originalName: attachment.name,
            storageUrl: uploaded.url,
            storageKey: uploaded.pathname,
            mimeType,
            sha256,
            sizeBytes: data.length,
          };
        } catch (error) {
          throw new DyadError(
            `Could not store "${attachment.name}" in the selected cloud storage: ${error instanceof Error ? error.message : String(error)}`,
            DyadErrorKind.External,
          );
        }
      }

      const vaultRoot = storage?.localVaultPath?.trim();
      if (!vaultRoot) {
        throw new DyadError(
          "No local file vault is connected. Choose one in Settings → Storage before attaching an image to a data-source record.",
          DyadErrorKind.Precondition,
        );
      }
      const fileDestination = path.join(
        path.resolve(vaultRoot),
        ...relativePath.split("/"),
      );
      await fs.promises.mkdir(path.dirname(fileDestination), {
        recursive: true,
      });
      await fs.promises.writeFile(fileDestination, data, { flag: "wx" });
      return {
        originalName: attachment.name,
        storageUrl: buildVaultMediaUrl(relativePath),
        storageKey: relativePath,
        mimeType,
        sha256,
        sizeBytes: data.length,
      };
    }),
  );
}

export function buildDataSourceAttachmentContext(
  attachments: PersistedDataSourceAttachment[],
): string {
  if (attachments.length === 0) return "";
  return [
    "Trusted attachment storage metadata (created by Meta Human OS before this turn):",
    ...attachments.map(
      (attachment, index) =>
        `${index + 1}. ${attachment.originalName}\n   storage_url: ${attachment.storageUrl}\n   storage_key: ${attachment.storageKey}\n   mime_type: ${attachment.mimeType}\n   sha256: ${attachment.sha256}\n   size_bytes: ${attachment.sizeBytes}`,
    ),
    "When the user asks to attach or link one of these files to a database record, use these exact values. Never invent or shorten a storage URL/key, and never create a placeholder path.",
  ].join("\n");
}
