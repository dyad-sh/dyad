/**
 * Code Studio IPC Handlers
 *
 * Filesystem operations for the in-app Code Studio editor.
 *
 * Channel naming: `code-studio:*`. Handlers throw on error; renderers receive
 * a rejected promise. Operations are scoped to a user-selected workspace root
 * (no path-traversal allowed; all paths must resolve under the chosen root).
 */

import { ipcMain, dialog, BrowserWindow, type IpcMainInvokeEvent } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import log from "electron-log";
import { gitClone } from "../utils/git_utils";
import { getUserDataPath } from "../../paths/paths";

const logger = log.scope("code-studio");

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export interface FsEntry {
  name: string;
  path: string;          // absolute
  relPath: string;       // relative to workspace root
  type: "file" | "directory";
  size?: number;
  modifiedMs?: number;
}

export interface OpenFileResult {
  path: string;
  relPath: string;
  content: string;
  language: string;
  size: number;
  modifiedMs: number;
}

export interface WriteFilePatch {
  path: string;          // workspace-relative
  oldContent?: string;   // for diff generation
  newContent: string;
  createIfMissing?: boolean;
}

export interface PatchPreview {
  path: string;
  unifiedDiff: string;
  added: number;
  removed: number;
  isCreate: boolean;
}

/** A registered project / workspace shown in the project switcher. */
export interface CodeStudioProject {
  id: string;
  name: string;
  root: string;
  /** ISO timestamp of last time this project was opened. */
  lastOpenedAt: string;
  /** Origin of the project — opened locally or cloned from a git remote. */
  kind: "local" | "cloned";
  /** Original clone URL when kind === "cloned". */
  remoteUrl?: string;
}

// ---------------------------------------------------------------------------
// STATE — current workspace root (per main-process lifetime)
// ---------------------------------------------------------------------------

let workspaceRoot: string | null = null;

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "out",
  ".turbo",
  ".cache",
  ".vite",
  ".vscode-test",
]);

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript",
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", hpp: "cpp",
  cs: "csharp", kt: "kotlin", swift: "swift", dart: "dart",
  php: "php", lua: "lua", sh: "shell", ps1: "powershell",
  sql: "sql", html: "html", css: "css", scss: "scss",
  json: "json", yaml: "yaml", yml: "yaml", toml: "ini",
  md: "markdown", mdx: "markdown",
  sol: "sol", zig: "zig", ex: "elixir", exs: "elixir",
  fs: "fsharp", fsx: "fsharp",
};

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function requireWorkspace(): string {
  if (!workspaceRoot) {
    throw new Error("No workspace open. Call code-studio:open-workspace first.");
  }
  return workspaceRoot;
}

// -- Projects store (persisted to userData/code-studio/projects.json) ------

function getProjectsFile(): string {
  return path.join(getUserDataPath(), "code-studio", "projects.json");
}

async function readProjects(): Promise<CodeStudioProject[]> {
  try {
    const raw = await fs.readFile(getProjectsFile(), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is CodeStudioProject =>
        !!p &&
        typeof (p as CodeStudioProject).id === "string" &&
        typeof (p as CodeStudioProject).root === "string" &&
        typeof (p as CodeStudioProject).name === "string",
    );
  } catch {
    return [];
  }
}

async function writeProjects(projects: CodeStudioProject[]): Promise<void> {
  const file = getProjectsFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(projects, null, 2), "utf-8");
}

function makeProjectId(): string {
  return `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Insert-or-update a project by `root` and bump its `lastOpenedAt`. */
async function upsertProject(
  partial: Omit<CodeStudioProject, "id" | "lastOpenedAt"> & { id?: string },
): Promise<CodeStudioProject> {
  const projects = await readProjects();
  const existing = projects.find(
    (p) => path.resolve(p.root) === path.resolve(partial.root),
  );
  const now = new Date().toISOString();
  if (existing) {
    existing.lastOpenedAt = now;
    existing.name = partial.name || existing.name;
    if (partial.kind) existing.kind = partial.kind;
    if (partial.remoteUrl) existing.remoteUrl = partial.remoteUrl;
    await writeProjects(projects);
    return existing;
  }
  const created: CodeStudioProject = {
    id: partial.id ?? makeProjectId(),
    name: partial.name,
    root: partial.root,
    kind: partial.kind ?? "local",
    remoteUrl: partial.remoteUrl,
    lastOpenedAt: now,
  };
  projects.push(created);
  await writeProjects(projects);
  return created;
}

/** Resolves a path relative to the workspace root and ensures it stays inside. */
function resolveSafe(relOrAbs: string): string {
  const root = requireWorkspace();
  const abs = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(root, relOrAbs);
  const normalized = path.resolve(abs);
  const normalizedRoot = path.resolve(root);
  if (
    normalized !== normalizedRoot &&
    !normalized.startsWith(normalizedRoot + path.sep)
  ) {
    throw new Error(`Path escapes workspace root: ${relOrAbs}`);
  }
  return normalized;
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  return LANG_BY_EXT[ext] ?? "plaintext";
}

async function readDirEntries(dir: string, root: string): Promise<FsEntry[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const entries: FsEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith(".") && d.name !== ".env" && d.name !== ".gitignore") {
      // hide dotfiles by default except a few useful ones
      if (!d.isDirectory() || IGNORED_DIRS.has(d.name)) continue;
    }
    if (d.isDirectory() && IGNORED_DIRS.has(d.name)) continue;
    const abs = path.join(dir, d.name);
    let stat: { size: number; mtimeMs: number } | undefined;
    if (d.isFile()) {
      try {
        const s = await fs.stat(abs);
        stat = { size: s.size, mtimeMs: s.mtimeMs };
      } catch {
        // ignore
      }
    }
    entries.push({
      name: d.name,
      path: abs,
      relPath: path.relative(root, abs).replace(/\\/g, "/"),
      type: d.isDirectory() ? "directory" : "file",
      size: stat?.size,
      modifiedMs: stat?.mtimeMs,
    });
  }
  // directories first, then alphabetical
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return entries;
}

// ---------------------------------------------------------------------------
// HANDLERS
// ---------------------------------------------------------------------------

export function registerCodeStudioHandlers(): void {
  // -- Workspace --------------------------------------------------------------

  ipcMain.handle("code-studio:open-workspace", async (event: IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const result = await dialog.showOpenDialog(win!, {
      title: "Open Folder in Code Studio",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    workspaceRoot = path.resolve(result.filePaths[0]);
    await upsertProject({
      name: path.basename(workspaceRoot),
      root: workspaceRoot,
      kind: "local",
    });
    return { root: workspaceRoot, name: path.basename(workspaceRoot) };
  });

  ipcMain.handle(
    "code-studio:set-workspace",
    async (_event: IpcMainInvokeEvent, root: string) => {
      const resolved = path.resolve(root);
      const stat = await fs.stat(resolved);
      if (!stat.isDirectory()) {
        throw new Error(`Not a directory: ${root}`);
      }
      workspaceRoot = resolved;
      await upsertProject({
        name: path.basename(workspaceRoot),
        root: workspaceRoot,
        kind: "local",
      });
      return { root: workspaceRoot, name: path.basename(workspaceRoot) };
    },
  );

  ipcMain.handle("code-studio:get-workspace", async () => {
    if (!workspaceRoot) return null;
    return { root: workspaceRoot, name: path.basename(workspaceRoot) };
  });

  // -- Filesystem -------------------------------------------------------------

  ipcMain.handle(
    "code-studio:list-dir",
    async (_event: IpcMainInvokeEvent, relPath: string = "") => {
      const root = requireWorkspace();
      const dir = resolveSafe(relPath || ".");
      return readDirEntries(dir, root);
    },
  );

  ipcMain.handle(
    "code-studio:read-file",
    async (_event: IpcMainInvokeEvent, relPath: string): Promise<OpenFileResult> => {
      const root = requireWorkspace();
      const abs = resolveSafe(relPath);
      const stat = await fs.stat(abs);
      if (stat.size > 5 * 1024 * 1024) {
        throw new Error(`File too large to open in editor: ${relPath} (${stat.size} bytes)`);
      }
      const content = await fs.readFile(abs, "utf-8");
      return {
        path: abs,
        relPath: path.relative(root, abs).replace(/\\/g, "/"),
        content,
        language: detectLanguage(abs),
        size: stat.size,
        modifiedMs: stat.mtimeMs,
      };
    },
  );

  ipcMain.handle(
    "code-studio:write-file",
    async (_event: IpcMainInvokeEvent, relPath: string, content: string) => {
      const abs = resolveSafe(relPath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, "utf-8");
      const stat = await fs.stat(abs);
      return { path: abs, size: stat.size, modifiedMs: stat.mtimeMs };
    },
  );

  ipcMain.handle(
    "code-studio:delete-file",
    async (_event: IpcMainInvokeEvent, relPath: string) => {
      const abs = resolveSafe(relPath);
      const stat = await fs.stat(abs);
      if (stat.isDirectory()) {
        await fs.rm(abs, { recursive: true, force: true });
      } else {
        await fs.unlink(abs);
      }
    },
  );

  ipcMain.handle(
    "code-studio:create-file",
    async (_event: IpcMainInvokeEvent, relPath: string, initialContent: string = "") => {
      const abs = resolveSafe(relPath);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      // exclusive create — fail if exists
      const handle = await fs.open(abs, "wx");
      try {
        await handle.writeFile(initialContent, "utf-8");
      } finally {
        await handle.close();
      }
      return { path: abs };
    },
  );

  // -- Patch / diff helpers ---------------------------------------------------

  ipcMain.handle(
    "code-studio:preview-patch",
    async (_event: IpcMainInvokeEvent, patch: WriteFilePatch): Promise<PatchPreview> => {
      const abs = resolveSafe(patch.path);
      let oldContent = patch.oldContent ?? "";
      let isCreate = false;
      try {
        oldContent = await fs.readFile(abs, "utf-8");
      } catch {
        isCreate = true;
        oldContent = patch.oldContent ?? "";
      }
      const unifiedDiff = createTwoFilesPatch(
        patch.path,
        patch.path,
        oldContent,
        patch.newContent,
      );
      // count added/removed lines
      let added = 0;
      let removed = 0;
      for (const line of unifiedDiff.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) added++;
        else if (line.startsWith("-") && !line.startsWith("---")) removed++;
      }
      return {
        path: patch.path,
        unifiedDiff,
        added,
        removed,
        isCreate,
      };
    },
  );

  ipcMain.handle(
    "code-studio:apply-patches",
    async (_event: IpcMainInvokeEvent, patches: WriteFilePatch[]) => {
      const results: Array<{ path: string; status: "applied" | "skipped"; reason?: string }> = [];
      for (const patch of patches) {
        const abs = resolveSafe(patch.path);
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, patch.newContent, "utf-8");
        results.push({ path: patch.path, status: "applied" });
      }
      return results;
    },
  );

  // -- Search -----------------------------------------------------------------

  ipcMain.handle(
    "code-studio:search",
    async (
      _event: IpcMainInvokeEvent,
      query: string,
      opts: { caseSensitive?: boolean; maxResults?: number; maxFileBytes?: number } = {},
    ) => {
      const root = requireWorkspace();
      const max = opts.maxResults ?? 200;
      const maxFileBytes = opts.maxFileBytes ?? 512 * 1024;
      const matcher = opts.caseSensitive
        ? (line: string) => line.includes(query)
        : ((q) => (line: string) => line.toLowerCase().includes(q))(query.toLowerCase());

      type Hit = { path: string; relPath: string; line: number; preview: string };
      const hits: Hit[] = [];

      async function walk(dir: string): Promise<void> {
        if (hits.length >= max) return;
        let dirents: import("node:fs").Dirent[];
        try {
          dirents = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const d of dirents) {
          if (hits.length >= max) return;
          if (IGNORED_DIRS.has(d.name)) continue;
          const abs = path.join(dir, d.name);
          if (d.isDirectory()) {
            await walk(abs);
          } else if (d.isFile()) {
            try {
              const stat = await fs.stat(abs);
              if (stat.size > maxFileBytes) continue;
              const content = await fs.readFile(abs, "utf-8");
              const lines = content.split("\n");
              for (let i = 0; i < lines.length; i++) {
                if (matcher(lines[i])) {
                  hits.push({
                    path: abs,
                    relPath: path.relative(root, abs).replace(/\\/g, "/"),
                    line: i + 1,
                    preview: lines[i].slice(0, 240),
                  });
                  if (hits.length >= max) return;
                }
              }
            } catch {
              // skip unreadable file
            }
          }
        }
      }

      await walk(root);
      return hits;
    },
  );

  // -- Projects (multi-project switcher) -------------------------------------

  ipcMain.handle("code-studio:list-projects", async (): Promise<CodeStudioProject[]> => {
    const projects = await readProjects();
    // Most-recently-opened first
    return [...projects].sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
  });

  ipcMain.handle(
    "code-studio:add-project",
    async (event: IpcMainInvokeEvent): Promise<CodeStudioProject | null> => {
      const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
      const result = await dialog.showOpenDialog(win!, {
        title: "Add Project to Code Studio",
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const root = path.resolve(result.filePaths[0]);
      return upsertProject({ name: path.basename(root), root, kind: "local" });
    },
  );

  ipcMain.handle(
    "code-studio:remove-project",
    async (_event: IpcMainInvokeEvent, projectId: string): Promise<void> => {
      const projects = await readProjects();
      const next = projects.filter((p) => p.id !== projectId);
      await writeProjects(next);
    },
  );

  ipcMain.handle(
    "code-studio:switch-project",
    async (_event: IpcMainInvokeEvent, projectId: string): Promise<{ root: string; name: string }> => {
      const projects = await readProjects();
      const project = projects.find((p) => p.id === projectId);
      if (!project) throw new Error(`Project not found: ${projectId}`);
      const stat = await fs.stat(project.root).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        throw new Error(`Project folder no longer exists: ${project.root}`);
      }
      workspaceRoot = path.resolve(project.root);
      project.lastOpenedAt = new Date().toISOString();
      await writeProjects(projects);
      return { root: workspaceRoot, name: project.name };
    },
  );

  ipcMain.handle(
    "code-studio:clone-repo",
    async (
      event: IpcMainInvokeEvent,
      args: { url: string; parentDir?: string; folderName?: string; accessToken?: string; depth?: number },
    ): Promise<CodeStudioProject> => {
      if (!args?.url || typeof args.url !== "string") {
        throw new Error("Repository URL is required");
      }
      const url = args.url.trim();
      // Pick parent directory if not provided
      let parentDir = args.parentDir;
      if (!parentDir) {
        const win = BrowserWindow.fromWebContents(event.sender) ?? undefined;
        const result = await dialog.showOpenDialog(win!, {
          title: "Choose folder to clone into",
          properties: ["openDirectory", "createDirectory"],
        });
        if (result.canceled || result.filePaths.length === 0) {
          throw new Error("Clone cancelled — no parent folder selected");
        }
        parentDir = result.filePaths[0];
      }
      // Derive folder name from URL if not provided ("https://github.com/foo/bar.git" -> "bar")
      const derivedName =
        args.folderName?.trim() ||
        url.replace(/\.git$/i, "").split(/[\\/]/).filter(Boolean).pop() ||
        `repo-${Date.now()}`;
      const targetDir = path.resolve(parentDir, derivedName);

      // Refuse to clone into an existing non-empty directory
      try {
        const existing = await fs.readdir(targetDir);
        if (existing.length > 0) {
          throw new Error(`Target folder already exists and is not empty: ${targetDir}`);
        }
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "ENOENT") throw err;
      }
      await fs.mkdir(targetDir, { recursive: true });

      logger.info(`Cloning ${url} -> ${targetDir}`);
      try {
        await gitClone({
          path: targetDir,
          url,
          accessToken: args.accessToken,
          singleBranch: true,
          depth: args.depth,
        });
      } catch (err) {
        // Best-effort cleanup of the empty / partial directory so the user can retry
        await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
        throw new Error(`Clone failed: ${(err as Error).message}`);
      }

      workspaceRoot = targetDir;
      const project = await upsertProject({
        name: derivedName,
        root: targetDir,
        kind: "cloned",
        remoteUrl: url,
      });
      logger.info(`Cloned and registered project ${project.id} at ${targetDir}`);
      return project;
    },
  );
}
