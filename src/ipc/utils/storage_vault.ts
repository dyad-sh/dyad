import fs from "node:fs";
import path from "node:path";
import { ensureMemoryVault } from "./memory_vault";
import { recoverAbandonedJobs } from "./memory_jobs";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { apps, chats, messages } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadAppPath } from "@/paths/paths";
import { DYAD_MEDIA_DIR_NAME } from "./media_path_utils";
import { uploadToBlob } from "./vercel_blob";
import { syncAppCodeToVault } from "./vault_code";
import {
  GENERATED_MEDIA_FOLDER,
  VAULT_FOLDERS,
  vaultStarterFiles,
} from "./vault_structure";
import {
  blobVaultKey,
  mirrorLocalVaultToBlob,
  scaffoldBlobVault,
} from "./blob_vault";

export type StoragePreferences = {
  destination: "local" | "cloud";
  localVaultPath?: string;
  autoSync: boolean;
  syncConversations: boolean;
  syncGeneratedMedia: boolean;
  syncSystemNotes: boolean;
};

export type PortableConversation = {
  id: string;
  title: string;
  source?: string;
  updatedAt: number;
  messages: { role: "user" | "assistant"; content: string }[];
};

type VaultFile = {
  relativePath: string;
  data: Buffer;
  contentType: string;
  kind: "conversation" | "note" | "media";
  overwrite?: boolean;
};

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".heic",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".webp",
]);
const VIDEO_EXTENSIONS = new Set([".mov", ".mp4", ".m4v", ".webm"]);
const VAULT_MANIFEST_PATH = ".meta-human/manifest.json";

function safeName(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return cleaned.slice(0, 100) || "Untitled";
}

function yamlValue(value: string): string {
  return JSON.stringify(value.replace(/\r?\n/g, " "));
}

function conversationMarkdown(input: {
  title: string;
  source: string;
  id: string;
  updatedAt: number;
  messages: { role: "user" | "assistant"; content: string }[];
}): Buffer {
  const body = input.messages
    .map(
      (message) =>
        `## ${message.role === "user" ? "You" : "Assistant"}\n\n${message.content.trim() || "_Empty message_"}`,
    )
    .join("\n\n---\n\n");
  return Buffer.from(
    `---\ntype: conversation\nsource: ${yamlValue(input.source)}\nconversation_id: ${yamlValue(input.id)}\nupdated: ${new Date(input.updatedAt).toISOString()}\ntags:\n  - meta-human\n  - conversation\n---\n\n# ${input.title}\n\n${body}\n`,
    "utf8",
  );
}

function assertVaultPath(vaultPath: string): string {
  const resolved = path.resolve(vaultPath.trim());
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) {
    throw new DyadError(
      "Choose a dedicated folder for the local vault.",
      DyadErrorKind.Validation,
    );
  }
  return resolved;
}

export async function initializeLocalVault(vaultPath: string): Promise<string> {
  const root = assertVaultPath(vaultPath);
  const folders = VAULT_FOLDERS;
  await Promise.all(
    folders.map((folder) =>
      fs.promises.mkdir(path.join(root, folder), { recursive: true }),
    ),
  );
  // The AI's memory tree. Additive and idempotent, so an existing vault gains
  // whatever is missing without any of the user's own files being touched.
  await ensureMemoryVault(root);
  // Anything left in Processing belongs to a run that died; return it to the
  // queue so interrupted extraction resumes rather than being lost.
  await recoverAbandonedJobs(root);
  const starterFiles = vaultStarterFiles();
  await Promise.all(
    Object.entries(starterFiles).map(async ([relativePath, contents]) => {
      const destination = path.join(root, ...relativePath.split("/"));
      if (!fs.existsSync(destination)) {
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await fs.promises.writeFile(destination, contents, "utf8");
      }
    }),
  );
  return root;
}

/**
 * Folder inside the vault that the Knowledge Base indexes. Anything dropped
 * here (by the user or by the app) becomes searchable local knowledge.
 */
export function vaultDocumentsPath(vaultPath: string): string {
  return path.join(assertVaultPath(vaultPath), "Documents");
}

export function isLocalVaultReady(vaultPath?: string): boolean {
  if (!vaultPath?.trim()) return false;
  try {
    const root = assertVaultPath(vaultPath);
    return fs.existsSync(root) && fs.statSync(root).isDirectory();
  } catch {
    return false;
  }
}

export async function saveGeneratedImageToLocalVault(input: {
  vaultPath: string;
  fileName: string;
  data: Buffer;
  prompt?: string;
  model?: string;
}): Promise<string> {
  const root = await initializeLocalVault(input.vaultPath);
  const destination = path.join(
    root,
    "Media",
    "Images",
    GENERATED_MEDIA_FOLDER,
    safeName(input.fileName),
  );
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  await fs.promises.writeFile(destination, input.data);
  const notePath = path.join(
    root,
    "Notes",
    "Generated Media",
    `${safeName(path.parse(input.fileName).name)}.md`,
  );
  await fs.promises.mkdir(path.dirname(notePath), { recursive: true });
  if (!fs.existsSync(notePath)) {
    const relativeMediaPath = path
      .relative(root, destination)
      .split(path.sep)
      .join("/");
    await fs.promises.writeFile(
      notePath,
      `---\ntype: generated-image\ncreated: ${new Date().toISOString()}\n${input.model ? `model: ${yamlValue(input.model)}\n` : ""}tags:\n  - meta-human\n  - generated-image\n---\n\n# ${safeName(path.parse(input.fileName).name)}\n\n![[${relativeMediaPath}]]\n\n${input.prompt ? `## Prompt\n\n${input.prompt.trim()}\n` : ""}`,
      "utf8",
    );
  }
  return destination;
}

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mov": "video/quicktime",
    ".mp4": "video/mp4",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm",
  };
  return types[ext] ?? "application/octet-stream";
}

async function mediaFilesForApp(
  appName: string,
  appPath: string,
): Promise<VaultFile[]> {
  const mediaRoot = path.join(getDyadAppPath(appPath), DYAD_MEDIA_DIR_NAME);
  if (!fs.existsSync(mediaRoot)) return [];
  const entries = await fs.promises.readdir(mediaRoot, { withFileTypes: true });
  const files: VaultFile[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) continue;
    const source = path.join(mediaRoot, entry.name);
    const ext = path.extname(entry.name).toLowerCase();
    const category = IMAGE_EXTENSIONS.has(ext)
      ? "Images"
      : VIDEO_EXTENSIONS.has(ext)
        ? "Videos"
        : "Files";
    files.push({
      relativePath: `Media/${category}/${safeName(appName)}/${safeName(entry.name)}`,
      data: await fs.promises.readFile(source),
      contentType: contentTypeFor(source),
      kind: "media",
    });
  }
  return files;
}

async function buildVaultFiles(
  preferences: StoragePreferences,
  chatAgentConversations: PortableConversation[],
): Promise<VaultFile[]> {
  const allApps = await db.select().from(apps);
  const files: VaultFile[] = [];

  if (preferences.syncConversations) {
    for (const app of allApps) {
      const appChats = await db
        .select()
        .from(chats)
        .where(eq(chats.appId, app.id));
      for (const chat of appChats) {
        const chatMessages = await db
          .select()
          .from(messages)
          .where(eq(messages.chatId, chat.id));
        const title = chat.title?.trim() || `Conversation ${chat.id}`;
        files.push({
          relativePath: `Conversations/Apps/${safeName(app.name)}/${safeName(title)} - ${chat.id}.md`,
          data: conversationMarkdown({
            title,
            source: app.name,
            id: String(chat.id),
            updatedAt: chat.createdAt.getTime(),
            messages: chatMessages.map((message) => ({
              role: message.role,
              content: message.content,
            })),
          }),
          contentType: "text/markdown; charset=utf-8",
          kind: "conversation",
        });
      }
    }
    for (const conversation of chatAgentConversations) {
      const source = conversation.source?.trim() || "Chat Agent";
      const conversationFolder =
        source === "Chat Agent"
          ? "Chat Agent"
          : `Hermes Agents/${safeName(source)}`;
      files.push({
        relativePath: `Conversations/${conversationFolder}/${safeName(conversation.title)} - ${safeName(conversation.id)}.md`,
        data: conversationMarkdown({
          title: conversation.title,
          source,
          id: conversation.id,
          updatedAt: conversation.updatedAt,
          messages: conversation.messages,
        }),
        contentType: "text/markdown; charset=utf-8",
        kind: "conversation",
      });
    }
  }

  if (preferences.syncSystemNotes) {
    files.push({
      relativePath: "Notes/System Notes.md",
      data: Buffer.from(
        "# System Notes\n\nThis note is reserved for durable notes created by the system. Add your own Markdown here at any time.\n",
      ),
      contentType: "text/markdown; charset=utf-8",
      kind: "note",
      overwrite: false,
    });
    for (const app of allApps) {
      if (!app.chatContext) continue;
      const context =
        typeof app.chatContext === "string"
          ? app.chatContext
          : JSON.stringify(app.chatContext, null, 2);
      files.push({
        relativePath: `Notes/Apps/${safeName(app.name)}.md`,
        data: Buffer.from(
          `# ${app.name}\n\n## System context\n\n${context}\n`,
          "utf8",
        ),
        contentType: "text/markdown; charset=utf-8",
        kind: "note",
      });
    }
  }

  if (preferences.syncGeneratedMedia) {
    for (const app of allApps) {
      files.push(...(await mediaFilesForApp(app.name, app.path)));
    }
  }
  return files;
}

/**
 * Index notes as content, so both destinations write identical files.
 *
 * Extracted from the local writer for exactly that reason: an index that was
 * generated one way on disk and another in the cloud would make the two
 * copies disagree about what the vault contains.
 */
export function buildVaultIndexes(files: VaultFile[]): Record<string, string> {
  const conversations = files
    .filter(
      (file) =>
        file.kind === "conversation" && file.relativePath.endsWith(".md"),
    )
    .map((file) => file.relativePath)
    .sort((a, b) => a.localeCompare(b));

  const media = files
    .filter((file) => file.kind === "media")
    .map((file) => file.relativePath)
    .sort((a, b) => a.localeCompare(b));

  return {
    "Conversations.md": `# Conversations\n\n${
      conversations.length
        ? conversations.map(markdownLink).join("\n")
        : "No conversations have been synced yet."
    }\n`,
    "Media.md": `# Media\n\n${
      media.length
        ? media.map(markdownLink).join("\n")
        : "No media has been synced yet."
    }\n`,
  };
}

/** The manifest, as data, so both destinations record the same thing. */
export function buildVaultManifest(files: VaultFile[]) {
  return {
    version: 1,
    syncedAt: new Date().toISOString(),
    files: files.map((file) => ({
      path: file.relativePath,
      kind: file.kind,
      bytes: file.data.length,
    })),
  };
}

export async function syncVault(input: {
  preferences: StoragePreferences;
  chatAgentConversations: PortableConversation[];
}): Promise<{ conversations: number; notes: number; media: number }> {
  const files = await buildVaultFiles(
    input.preferences,
    input.chatAgentConversations,
  );
  if (input.preferences.destination === "local") {
    if (!input.preferences.localVaultPath) {
      throw new DyadError(
        "Choose a local vault folder before syncing.",
        DyadErrorKind.Precondition,
      );
    }
    const root = await initializeLocalVault(input.preferences.localVaultPath);
    for (const file of files) {
      const destination = path.join(root, ...file.relativePath.split("/"));
      await fs.promises.mkdir(path.dirname(destination), { recursive: true });
      if (file.overwrite !== false || !fs.existsSync(destination)) {
        await fs.promises.writeFile(destination, file.data);
      }
    }
    await writeVaultIndexes(root, files);
    await writeVaultManifest(root, files);

    // Mirror every coder project's source (with its git history) into Code/.
    const allApps = await db.query.apps.findMany();
    for (const appRow of allApps) {
      try {
        await syncAppCodeToVault({
          appDir: getDyadAppPath(appRow.path),
          vaultRoot: root,
          appPath: appRow.path,
        });
      } catch {
        // One unreadable project must not fail the whole sync.
      }
    }
  } else {
    // The cloud copy is a vault, not a pile of files: same structure, same
    // indexes, same manifest, so a store can be browsed or restored on its own
    // terms rather than only making sense next to a local copy.
    await scaffoldBlobVault();

    for (const file of files) {
      await uploadToBlob(blobVaultKey(file.relativePath), file.data, {
        contentType: file.contentType,
        allowOverwrite: true,
      });
    }

    for (const [relativePath, contents] of Object.entries(
      buildVaultIndexes(files),
    )) {
      await uploadToBlob(blobVaultKey(relativePath), Buffer.from(contents), {
        contentType: "text/markdown",
        allowOverwrite: true,
      });
    }

    await uploadToBlob(
      blobVaultKey(VAULT_MANIFEST_PATH),
      Buffer.from(JSON.stringify(buildVaultManifest(files), null, 2)),
      { contentType: "application/json", allowOverwrite: true },
    );

    // When a local vault exists it is the source of truth, so the cloud gets
    // an exact copy of it rather than only the files this sync generated.
    // Anything the user put in the vault by hand belongs in the backup too.
    const vaultPath = input.preferences.localVaultPath?.trim();
    if (vaultPath && isLocalVaultReady(vaultPath)) {
      await mirrorLocalVaultToBlob(vaultPath);
    }
  }
  return {
    conversations: files.filter((file) => file.kind === "conversation").length,
    notes: files.filter((file) => file.kind === "note").length,
    media: files.filter((file) => file.kind === "media").length,
  };
}

function markdownLink(relativePath: string): string {
  const withoutExtension = relativePath.replace(/\.md$/i, "");
  const label = path.basename(withoutExtension);
  return `- [[${withoutExtension}|${label}]]`;
}

async function writeVaultIndexes(root: string, files: VaultFile[]) {
  const conversations = files
    .filter(
      (file) =>
        file.kind === "conversation" && file.relativePath.endsWith(".md"),
    )
    .map((file) => file.relativePath)
    .sort((a, b) => a.localeCompare(b));
  const notes = files
    .filter((file) => file.kind === "note" && file.relativePath.endsWith(".md"))
    .map((file) => file.relativePath)
    .filter((file) => file !== "Notes/System Notes.md")
    .sort((a, b) => a.localeCompare(b));
  const media = files
    .filter((file) => file.kind === "media")
    .map((file) => file.relativePath)
    .sort((a, b) => a.localeCompare(b));

  await fs.promises.writeFile(
    path.join(root, "Conversations.md"),
    `---\ntype: index\nupdated: ${new Date().toISOString()}\n---\n\n# Conversations\n\n${
      conversations.length
        ? conversations.map(markdownLink).join("\n")
        : "_No conversations have been synced yet._"
    }\n`,
    "utf8",
  );
  await fs.promises.writeFile(
    path.join(root, "Notes.md"),
    `---\ntype: index\nupdated: ${new Date().toISOString()}\n---\n\n# Notes\n\n- [[Notes/System Notes|System Notes]]\n${
      notes.length ? notes.map(markdownLink).join("\n") : ""
    }\n\nYour own Markdown files can be added anywhere in this vault.\n`,
    "utf8",
  );
  await fs.promises.writeFile(
    path.join(root, "Media.md"),
    `---\ntype: index\nupdated: ${new Date().toISOString()}\n---\n\n# Media\n\n${
      media.length
        ? media.map((file) => `- [[${file}]]`).join("\n")
        : "_No generated media has been synced yet._"
    }\n`,
    "utf8",
  );
}

async function writeVaultManifest(root: string, files: VaultFile[]) {
  const manifestPath = path.join(root, ...VAULT_MANIFEST_PATH.split("/"));
  await fs.promises.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.promises.writeFile(
    manifestPath,
    JSON.stringify(
      {
        version: 1,
        managedBy: "Meta Human",
        lastSyncedAt: new Date().toISOString(),
        files: files.map((file) => ({
          path: file.relativePath,
          kind: file.kind,
        })),
      },
      null,
      2,
    ),
    "utf8",
  );
}
