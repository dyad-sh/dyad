/**
 * Code Studio IPC Client (renderer side)
 */

import type {
  FsEntry,
  OpenFileResult,
  WriteFilePatch,
  PatchPreview,
} from "@/ipc/handlers/code_studio_handlers";

interface ElectronIpc {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
}

function ipc(): ElectronIpc {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const electron = (window as any).electron;
  if (!electron?.ipcRenderer) {
    throw new Error("Code Studio IPC not available — preload not loaded");
  }
  return electron.ipcRenderer as ElectronIpc;
}

export interface WorkspaceInfo {
  root: string;
  name: string;
}

export interface SearchHit {
  path: string;
  relPath: string;
  line: number;
  preview: string;
}

class CodeStudioClient {
  private static instance: CodeStudioClient | null = null;

  static getInstance(): CodeStudioClient {
    if (!CodeStudioClient.instance) {
      CodeStudioClient.instance = new CodeStudioClient();
    }
    return CodeStudioClient.instance;
  }

  // -- Workspace ------------------------------------------------------------

  async openWorkspace(): Promise<WorkspaceInfo | null> {
    return ipc().invoke("code-studio:open-workspace") as Promise<WorkspaceInfo | null>;
  }

  async setWorkspace(root: string): Promise<WorkspaceInfo> {
    return ipc().invoke("code-studio:set-workspace", root) as Promise<WorkspaceInfo>;
  }

  async getWorkspace(): Promise<WorkspaceInfo | null> {
    return ipc().invoke("code-studio:get-workspace") as Promise<WorkspaceInfo | null>;
  }

  // -- Filesystem -----------------------------------------------------------

  async listDir(relPath: string = ""): Promise<FsEntry[]> {
    return ipc().invoke("code-studio:list-dir", relPath) as Promise<FsEntry[]>;
  }

  async readFile(relPath: string): Promise<OpenFileResult> {
    return ipc().invoke("code-studio:read-file", relPath) as Promise<OpenFileResult>;
  }

  async writeFile(
    relPath: string,
    content: string,
  ): Promise<{ path: string; size: number; modifiedMs: number }> {
    return ipc().invoke("code-studio:write-file", relPath, content) as Promise<{
      path: string;
      size: number;
      modifiedMs: number;
    }>;
  }

  async deleteFile(relPath: string): Promise<void> {
    await ipc().invoke("code-studio:delete-file", relPath);
  }

  async createFile(relPath: string, initialContent: string = ""): Promise<{ path: string }> {
    return ipc().invoke("code-studio:create-file", relPath, initialContent) as Promise<{
      path: string;
    }>;
  }

  // -- Patches --------------------------------------------------------------

  async previewPatch(patch: WriteFilePatch): Promise<PatchPreview> {
    return ipc().invoke("code-studio:preview-patch", patch) as Promise<PatchPreview>;
  }

  async applyPatches(
    patches: WriteFilePatch[],
  ): Promise<Array<{ path: string; status: "applied" | "skipped"; reason?: string }>> {
    return ipc().invoke("code-studio:apply-patches", patches) as Promise<
      Array<{ path: string; status: "applied" | "skipped"; reason?: string }>
    >;
  }

  // -- Search ---------------------------------------------------------------

  async search(
    query: string,
    opts: { caseSensitive?: boolean; maxResults?: number; maxFileBytes?: number } = {},
  ): Promise<SearchHit[]> {
    return ipc().invoke("code-studio:search", query, opts) as Promise<SearchHit[]>;
  }
}

export const codeStudioClient = CodeStudioClient.getInstance();

export type { FsEntry, OpenFileResult, WriteFilePatch, PatchPreview };
