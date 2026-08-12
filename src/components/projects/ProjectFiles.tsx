import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";

import { ipc } from "@/ipc/types";
import type { ProjectFile } from "@/ipc/types/project";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { vaultBreadcrumbs } from "@/lib/vault_paths";
import { showError, showSuccess } from "@/lib/toast";

/**
 * A project's files, browsed like a drive.
 *
 * Folders first, then files; a breadcrumb across the top; double-width rows so
 * a name and its size and date sit together. Adding copies the file into the
 * project rather than linking it, so the project survives the original being
 * moved or deleted.
 */

function formatSize(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function formatDate(epochMs: number | null): string {
  if (!epochMs) return "";
  return new Date(epochMs).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function ProjectFiles({ projectId }: { projectId: string }) {
  const queryClient = useQueryClient();
  const [path, setPath] = useState("");
  const [newFolder, setNewFolder] = useState("");
  const [isNamingFolder, setIsNamingFolder] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectFile | null>(null);

  const key = ["project-files", projectId, path] as const;
  const listing = useQuery({
    queryKey: key,
    queryFn: () => ipc.project.listFiles({ id: projectId, path }),
  });

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: ["project-files", projectId],
    });

  const addFiles = useMutation({
    mutationFn: () => ipc.project.addFiles({ id: projectId, path }),
    onSuccess: async ({ added }) => {
      // A cancelled dialog is neither a success nor a failure.
      if (added.length === 0) return;
      showSuccess(
        added.length === 1
          ? `Added ${added[0]}`
          : `Added ${added.length} files`,
      );
      await refresh();
    },
    onError: (error: Error) => showError(error.message),
  });

  const createFolder = useMutation({
    mutationFn: (name: string) =>
      ipc.project.createFolder({ id: projectId, path, name }),
    onSuccess: async () => {
      setNewFolder("");
      setIsNamingFolder(false);
      await refresh();
    },
    onError: (error: Error) => showError(error.message),
  });

  const deleteEntry = useMutation({
    mutationFn: (entry: ProjectFile) =>
      ipc.project.deleteFile({ id: projectId, path: entry.path }),
    onSuccess: async () => {
      setDeleteTarget(null);
      await refresh();
    },
    onError: (error: Error) => showError(error.message),
  });

  const reveal = (entryPath: string) => {
    void ipc.project
      .revealFile({ id: projectId, path: entryPath })
      .catch((error: Error) => showError(error.message));
  };

  const data = listing.data;
  const crumbs = vaultBreadcrumbs(path);

  return (
    <div className="mt-3 rounded-xl border border-cyan-500/12 bg-[rgba(4,12,24,0.5)]">
      <div className="flex flex-wrap items-center gap-2 border-b border-cyan-500/10 px-3 py-2">
        <nav
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-xs text-cyan-100/45"
          aria-label="Breadcrumb"
        >
          <button
            type="button"
            onClick={() => setPath("")}
            className="rounded px-1.5 py-0.5 hover:bg-cyan-500/10 hover:text-cyan-100"
          >
            Files
          </button>
          {crumbs.map((crumb) => (
            <span key={crumb.path} className="flex items-center gap-1">
              <ChevronRight className="size-3 opacity-50" />
              <button
                type="button"
                onClick={() => setPath(crumb.path)}
                className="rounded px-1.5 py-0.5 hover:bg-cyan-500/10 hover:text-cyan-100"
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => addFiles.mutate()}
            disabled={addFiles.isPending}
            data-testid="project-files-add"
          >
            <Upload className="size-3.5" />
            {addFiles.isPending ? "Adding…" : "Add files"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsNamingFolder((open) => !open)}
          >
            <FolderPlus className="size-3.5" />
            New folder
          </Button>
        </div>
      </div>

      {isNamingFolder && (
        <div className="flex items-center gap-2 border-b border-cyan-500/10 px-3 py-2">
          <Input
            value={newFolder}
            onChange={(event) => setNewFolder(event.target.value)}
            placeholder="Folder name"
            className="h-8 text-xs"
            onKeyDown={(event) => {
              if (event.key === "Enter" && newFolder.trim()) {
                createFolder.mutate(newFolder.trim());
              }
            }}
          />
          <Button
            size="sm"
            onClick={() => createFolder.mutate(newFolder.trim())}
            disabled={!newFolder.trim() || createFolder.isPending}
          >
            Create
          </Button>
        </div>
      )}

      {listing.isLoading && (
        <div className="flex items-center gap-2 p-4 text-xs text-white/45">
          <Loader2 className="size-3.5 animate-spin" />
          Reading files…
        </div>
      )}

      {data?.parent !== null && data && (
        <button
          type="button"
          onClick={() => setPath(data.parent ?? "")}
          className="flex w-full items-center gap-2 border-b border-cyan-500/8 px-3 py-2 text-left text-xs text-cyan-100/55 hover:bg-cyan-500/8"
        >
          <Folder className="size-3.5 shrink-0 text-cyan-300/60" />
          ..
        </button>
      )}

      {data?.entries.map((entry) => (
        <div
          key={entry.path}
          className="flex items-center gap-2 border-b border-cyan-500/8 px-3 py-2 text-xs last:border-b-0 hover:bg-cyan-500/8"
          data-testid={`project-file-${entry.kind}`}
        >
          <button
            type="button"
            onClick={() =>
              entry.kind === "directory"
                ? setPath(entry.path)
                : reveal(entry.path)
            }
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            {entry.kind === "directory" ? (
              <Folder className="size-3.5 shrink-0 text-cyan-300/70" />
            ) : (
              <FileIcon className="size-3.5 shrink-0 text-white/35" />
            )}
            <span className="truncate text-cyan-50/85">{entry.name}</span>
          </button>
          <span className="w-16 shrink-0 text-right text-[10px] text-white/30">
            {formatSize(entry.sizeBytes)}
          </span>
          <span className="hidden w-24 shrink-0 text-right text-[10px] text-white/25 sm:block">
            {formatDate(entry.modifiedAt)}
          </span>
          <button
            type="button"
            onClick={() => reveal(entry.path)}
            className="shrink-0 rounded p-1 text-white/30 hover:bg-cyan-500/10 hover:text-cyan-100"
            aria-label={`Show ${entry.name} in Finder`}
          >
            <FolderOpen className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setDeleteTarget(entry)}
            className="shrink-0 rounded p-1 text-white/30 hover:bg-rose-500/10 hover:text-rose-300"
            aria-label={`Delete ${entry.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}

      {data && data.entries.length === 0 && !listing.isLoading && (
        <p className="p-4 text-xs text-[#7aadb8]">
          {path ? "This folder is empty." : "No files in this project yet."}
        </p>
      )}

      <ConfirmationDialog
        isOpen={deleteTarget !== null}
        title={
          deleteTarget?.kind === "directory" ? "Delete folder?" : "Delete file?"
        }
        message={
          deleteTarget?.kind === "directory"
            ? `${deleteTarget?.name} and everything inside it will be deleted from this project.`
            : `${deleteTarget?.name ?? "This file"} will be deleted from this project.`
        }
        confirmText={deleteEntry.isPending ? "Deleting…" : "Delete"}
        cancelText="Cancel"
        confirmDisabled={deleteEntry.isPending}
        onConfirm={() => deleteTarget && deleteEntry.mutate(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
