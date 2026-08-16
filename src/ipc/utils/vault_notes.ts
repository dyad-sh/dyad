import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { VaultNote } from "@/ipc/types/storage";
import { blobVaultKey, scaffoldBlobVault } from "./blob_vault";
import { deleteBlob, listBlobs, uploadToBlob } from "./vercel_blob";
import { initializeLocalVault } from "./storage_vault";

const NOTES_DIRECTORY = path.join("Notes", "Vault");
const MANAGED_NOTE_FILE = / -- mh-.+-[a-f0-9]{10}\.md$/i;
const MANAGED_NOTE_MARKER = "source: notes-vault";

function safeSegment(value: string, fallback: string, maxLength = 100): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return (cleaned || fallback).slice(0, maxLength);
}

function displayTitle(note: VaultNote): string {
  return (
    note.title.trim() ||
    note.body.trim().split(/\r?\n/, 1)[0]?.slice(0, 100) ||
    "Untitled note"
  );
}

export function vaultNoteFileName(note: VaultNote): string {
  const title = safeSegment(displayTitle(note), "Untitled note");
  const id = safeSegment(note.id, "note", 80).replace(/\s+/g, "-");
  const fingerprint = crypto
    .createHash("sha256")
    .update(note.id)
    .digest("hex")
    .slice(0, 10);
  return `${title} -- mh-${id}-${fingerprint}.md`;
}

export function vaultNoteMarkdown(note: VaultNote): string {
  const title = displayTitle(note).replace(/\r?\n/g, " ");
  const body = note.body.trim();
  return `---
type: note
source: notes-vault
note_id: ${JSON.stringify(note.id)}
created: ${new Date(note.createdAt).toISOString()}
updated: ${new Date(note.updatedAt).toISOString()}
pinned: ${note.pinned}
tags:
  - meta-human
  - notes-vault
---

# ${title}

${body}${body ? "\n" : ""}`;
}

function isManagedNoteFile(fileName: string): boolean {
  return MANAGED_NOTE_FILE.test(fileName);
}

/** Mirror Notes Vault into its dedicated folder without touching user files. */
export async function syncVaultNotesToLocal(
  vaultPath: string,
  notes: VaultNote[],
): Promise<{ files: number; location: string }> {
  const root = await initializeLocalVault(vaultPath);
  const notesDirectory = path.join(root, NOTES_DIRECTORY);
  await fs.promises.mkdir(notesDirectory, { recursive: true });

  const desired = new Map(
    notes.map((note) => [vaultNoteFileName(note), vaultNoteMarkdown(note)]),
  );
  const existing = await fs.promises.readdir(notesDirectory, {
    withFileTypes: true,
  });

  for (const [fileName, markdown] of desired) {
    const destination = path.join(notesDirectory, fileName);
    try {
      const stats = await fs.promises.lstat(destination);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error(`Refusing to overwrite unsafe note path: ${fileName}`);
      }
      const existingContents = await fs.promises.readFile(destination, "utf8");
      if (!existingContents.includes(MANAGED_NOTE_MARKER)) {
        throw new Error(`Refusing to overwrite a user-owned note: ${fileName}`);
      }
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        throw error;
      }
    }
    await fs.promises.writeFile(destination, markdown, "utf8");
  }

  for (const entry of existing) {
    if (
      entry.isFile() &&
      isManagedNoteFile(entry.name) &&
      !desired.has(entry.name)
    ) {
      const stalePath = path.join(notesDirectory, entry.name);
      const contents = await fs.promises.readFile(stalePath, "utf8");
      if (contents.includes(MANAGED_NOTE_MARKER)) {
        await fs.promises.unlink(stalePath);
      }
    }
  }

  return { files: desired.size, location: notesDirectory };
}

/** Cloud storage receives the same paths and Markdown as the local vault. */
export async function syncVaultNotesToCloud(
  notes: VaultNote[],
): Promise<{ files: number; location: string }> {
  await scaffoldBlobVault();
  const prefix = blobVaultKey(`${NOTES_DIRECTORY}/`);
  const desired = new Map(
    notes.map((note) => [
      blobVaultKey(`${NOTES_DIRECTORY}/${vaultNoteFileName(note)}`),
      vaultNoteMarkdown(note),
    ]),
  );
  const existing = await listBlobs(prefix);

  for (const blob of existing) {
    const fileName = blob.pathname.split("/").pop() ?? "";
    if (isManagedNoteFile(fileName) && !desired.has(blob.pathname)) {
      await deleteBlob(blob.url);
    }
  }

  for (const [pathname, markdown] of desired) {
    await uploadToBlob(pathname, Buffer.from(markdown, "utf8"), {
      contentType: "text/markdown; charset=utf-8",
      allowOverwrite: true,
    });
  }

  return { files: desired.size, location: prefix };
}
