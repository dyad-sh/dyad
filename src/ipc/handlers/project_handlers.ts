import crypto from "node:crypto";
import fs from "node:fs";
import nodePath from "node:path";
import { BrowserWindow, dialog, shell } from "electron";
import { desc, eq } from "drizzle-orm";
import log from "electron-log";

import { db } from "../../db";
import { projects } from "../../db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { createTypedHandler } from "./base";
import { projectContracts } from "../types/project";
import { getUserDataPath } from "../../paths/paths";
import {
  VaultPathError,
  resolveInsideVault,
  vaultParentPath,
} from "@/lib/vault_paths";

const logger = log.scope("project_handlers");

function toDto(row: typeof projects.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    instructions: row.instructions,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

/**
 * Where a project keeps its files.
 *
 * Under userData, one folder per project id rather than per name, so renaming
 * a project does not move its files and two projects called the same thing
 * cannot collide.
 */
function projectFilesRoot(id: string): string {
  const root = nodePath.join(getUserDataPath(), "projects", id);
  fs.mkdirSync(root, { recursive: true });
  return root;
}

/**
 * An absolute path inside the project, or a thrown error.
 *
 * The renderer names the path, so this is the same confinement the vault
 * browser uses: "../.." is a valid relative path, and without this a folder
 * listing would be a way to read anything on the machine.
 */
function resolveInProject(id: string, relative: string): string {
  try {
    return resolveInsideVault(projectFilesRoot(id), relative);
  } catch (error) {
    throw new DyadError(
      error instanceof VaultPathError ? error.message : "Invalid path.",
      DyadErrorKind.Validation,
    );
  }
}

/**
 * Where a project's conversations are recorded.
 *
 * A folder of JSON beside the project's files rather than rows in the
 * database, so a project is one directory you could copy, inspect or back up
 * without the app.
 */
const CONVERSATIONS_DIR = "Conversations";

function conversationsRoot(projectId: string): string {
  const dir = nodePath.join(projectFilesRoot(projectId), CONVERSATIONS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function conversationFile(projectId: string, conversationId: string): string {
  // The id names the file, not the title: a title changes as the conversation
  // is renamed, and a rename must not leave a second copy behind.
  const safe = conversationId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) {
    throw new DyadError("Invalid conversation id.", DyadErrorKind.Validation);
  }
  return nodePath.join(conversationsRoot(projectId), `${safe}.json`);
}

export function registerProjectHandlers() {
  createTypedHandler(projectContracts.list, async () => {
    const rows = await db
      .select()
      .from(projects)
      .orderBy(desc(projects.updatedAt));
    return rows.map(toDto);
  });

  createTypedHandler(projectContracts.create, async (_event, input) => {
    const now = new Date();
    const [created] = await db
      .insert(projects)
      .values({
        id: crypto.randomUUID(),
        name: input.name.trim(),
        description: input.description?.trim() || null,
        instructions: input.instructions?.trim() || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return toDto(created);
  });

  createTypedHandler(projectContracts.update, async (_event, input) => {
    const [updated] = await db
      .update(projects)
      .set({
        // Only what was sent: a partial update must not blank the rest.
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.description !== undefined
          ? { description: input.description.trim() || null }
          : {}),
        ...(input.instructions !== undefined
          ? { instructions: input.instructions.trim() || null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, input.id))
      .returning();

    if (!updated) {
      throw new DyadError(
        "That project no longer exists.",
        DyadErrorKind.NotFound,
      );
    }
    return toDto(updated);
  });

  createTypedHandler(projectContracts.delete, async (_event, { id }) => {
    await db.delete(projects).where(eq(projects.id, id));
  });

  createTypedHandler(projectContracts.listFiles, async (_event, input) => {
    const absolute = resolveInProject(input.id, input.path);
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(absolute, { withFileTypes: true });
    } catch {
      // A folder deleted outside the app is an empty folder here, not a crash.
      return {
        path: input.path,
        parent: vaultParentPath(input.path),
        entries: [],
      };
    }

    const entries = dirents
      .filter((entry) => !entry.name.startsWith("."))
      .filter(
        (entry) => !(input.path === "" && entry.name === CONVERSATIONS_DIR),
      )
      .map((entry) => {
        const childPath = input.path
          ? `${input.path}/${entry.name}`
          : entry.name;
        const isDirectory = entry.isDirectory();
        let sizeBytes: number | null = null;
        let modifiedAt: number | null = null;
        try {
          const stats = fs.statSync(nodePath.join(absolute, entry.name));
          modifiedAt = stats.mtimeMs;
          if (!isDirectory) sizeBytes = stats.size;
        } catch {
          // Vanished between listing and stat; still worth showing.
        }
        return {
          name: entry.name,
          path: childPath,
          kind: isDirectory ? ("directory" as const) : ("file" as const),
          sizeBytes,
          modifiedAt,
        };
      })
      .sort((a, b) =>
        a.kind === b.kind
          ? a.name.localeCompare(b.name)
          : a.kind === "directory"
            ? -1
            : 1,
      );

    return {
      path: input.path,
      parent: vaultParentPath(input.path),
      entries,
    };
  });

  createTypedHandler(projectContracts.addFiles, async (_event, input) => {
    const destination = resolveInProject(input.id, input.path);
    const parent = BrowserWindow.getFocusedWindow();
    const options = {
      title: "Add files to this project",
      buttonLabel: "Add",
      properties: ["openFile", "multiSelections"] as Array<
        "openFile" | "multiSelections"
      >,
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled) return { added: [] };

    const added: string[] = [];
    for (const source of result.filePaths) {
      const name = nodePath.basename(source);
      // Copied, not linked: a project's files should survive the original
      // being moved or deleted.
      fs.copyFileSync(source, nodePath.join(destination, name));
      added.push(name);
    }
    return { added };
  });

  createTypedHandler(projectContracts.createFolder, async (_event, input) => {
    const name = input.name.trim();
    if (!name || name.includes("/") || name.includes("\\")) {
      throw new DyadError(
        "A folder name cannot contain slashes.",
        DyadErrorKind.Validation,
      );
    }
    const target = resolveInProject(
      input.id,
      input.path ? `${input.path}/${name}` : name,
    );
    fs.mkdirSync(target, { recursive: true });
  });

  createTypedHandler(projectContracts.deleteFile, async (_event, input) => {
    const target = resolveInProject(input.id, input.path);
    if (target === projectFilesRoot(input.id)) {
      throw new DyadError(
        "That would delete the whole project folder.",
        DyadErrorKind.Validation,
      );
    }
    fs.rmSync(target, { recursive: true, force: true });
  });

  createTypedHandler(projectContracts.revealFile, async (_event, input) => {
    const target = resolveInProject(input.id, input.path);
    if (!fs.existsSync(target)) {
      throw new DyadError(
        "That item is no longer there.",
        DyadErrorKind.NotFound,
      );
    }
    // openPath rather than showItemInFolder: the latter is synchronous on the
    // main thread and can block the app on a slow volume.
    const stats = fs.statSync(target);
    const error = await shell.openPath(
      stats.isDirectory() ? target : nodePath.dirname(target),
    );
    if (error) throw new DyadError(error, DyadErrorKind.External);
  });

  createTypedHandler(
    projectContracts.saveConversation,
    async (_event, input) => {
      // An empty conversation is not worth a file; it would show as a card for
      // something the user never said.
      if (input.messages.length === 0) return;

      fs.writeFileSync(
        conversationFile(input.projectId, input.conversationId),
        JSON.stringify(
          {
            id: input.conversationId,
            title: input.title,
            updatedAt: input.updatedAt,
            messages: input.messages,
          },
          null,
          2,
        ),
        "utf-8",
      );
    },
  );

  createTypedHandler(
    projectContracts.listConversations,
    async (_event, { projectId }) => {
      const dir = conversationsRoot(projectId);
      const files = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"));

      const conversations = files.flatMap((entry) => {
        try {
          const raw = JSON.parse(
            fs.readFileSync(nodePath.join(dir, entry.name), "utf-8"),
          ) as {
            id?: string;
            title?: string;
            updatedAt?: number;
            messages?: unknown[];
          };
          if (!raw.id) return [];
          return [
            {
              id: raw.id,
              title: raw.title || "Untitled conversation",
              updatedAt: raw.updatedAt ?? 0,
              messageCount: Array.isArray(raw.messages)
                ? raw.messages.length
                : 0,
            },
          ];
        } catch {
          // A corrupt file is skipped rather than taking the whole list down.
          logger.warn(`Skipping unreadable conversation ${entry.name}`);
          return [];
        }
      });

      return conversations.sort((a, b) => b.updatedAt - a.updatedAt);
    },
  );

  createTypedHandler(
    projectContracts.getConversation,
    async (_event, input) => {
      const file = conversationFile(input.projectId, input.conversationId);
      if (!fs.existsSync(file)) {
        throw new DyadError(
          "That conversation is no longer recorded here.",
          DyadErrorKind.NotFound,
        );
      }
      const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
        id: string;
        title?: string;
        updatedAt?: number;
        messages?: Array<{ role: string; content: string }>;
      };
      return {
        id: raw.id,
        title: raw.title || "Untitled conversation",
        updatedAt: raw.updatedAt ?? 0,
        messages: raw.messages ?? [],
      };
    },
  );

  createTypedHandler(
    projectContracts.deleteConversation,
    async (_event, input) => {
      fs.rmSync(conversationFile(input.projectId, input.conversationId), {
        force: true,
      });
    },
  );

  logger.info("Project handlers registered");
}
