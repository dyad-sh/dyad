import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  FolderPlus,
  Grid2x2,
  List,
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
import { cn } from "@/lib/utils";

/**
 * A project's files, as a drive.
 *
 * Grid by default, because a folder of things is easier to recognise by shape
 * than to read as a list; a list view for when the dates and sizes are what
 * you came for. Folders sort first in both.
 *
 * Adding copies the file into the project rather than linking it, so the
 * project survives the original being moved or deleted.
 */

const EXTENSION_ICONS: Array<[RegExp, typeof FileText]> = [
  [/\.(png|jpe?g|gif|webp|svg|heic|bmp)$/i, FileImage],
  [/\.(mp4|mov|avi|mkv|webm)$/i, FileVideo],
  [/\.(mp3|wav|flac|aac|m4a|ogg)$/i, FileAudio],
  [/\.(zip|tar|gz|rar|7z)$/i, FileArchive],
  [
    /\.(ts|tsx|js|jsx|py|rs|go|java|rb|sh|json|ya?ml|toml|css|html)$/i,
    FileCode,
  ],
];

function iconFor(entry: ProjectFile) {
  if (entry.kind === "directory") return Folder;
  for (const [pattern, icon] of EXTENSION_ICONS) {
    if (pattern.test(entry.name)) return icon;
  }
  return FileText;
}

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
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [newFolder, setNewFolder] = useState("");
  const [isNamingFolder, setIsNamingFolder] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectFile | null>(null);

  const listing = useQuery({
    queryKey: ["project-files", projectId, path],
    queryFn: () => ipc.project.listFiles({ id: projectId, path }),
  });

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["project-files", projectId] });

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

  const open = (entry: ProjectFile) =>
    entry.kind === "directory" ? setPath(entry.path) : reveal(entry.path);

  const data = listing.data;
  const entries = data?.entries ?? [];
  const crumbs = vaultBreadcrumbs(path);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <nav
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm text-cyan-100/50"
          aria-label="Breadcrumb"
        >
          <button
            type="button"
            onClick={() => setPath("")}
            className="rounded px-2 py-1 hover:bg-cyan-500/10 hover:text-cyan-100"
          >
            Files
          </button>
          {crumbs.map((crumb) => (
            <span key={crumb.path} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 opacity-40" />
              <button
                type="button"
                onClick={() => setPath(crumb.path)}
                className="rounded px-2 py-1 hover:bg-cyan-500/10 hover:text-cyan-100"
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            size="sm"
            onClick={() => addFiles.mutate()}
            disabled={addFiles.isPending}
            className="border-cyan-400/25 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
            data-testid="project-files-add"
          >
            <Upload className="size-3.5" />
            {addFiles.isPending ? "Adding…" : "Upload"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsNamingFolder((open) => !open)}
          >
            <FolderPlus className="size-3.5" />
            New folder
          </Button>
          <div className="ml-1 flex items-center rounded-lg border border-cyan-500/15 p-0.5">
            {(
              [
                ["grid", Grid2x2, "Grid view"],
                ["list", List, "List view"],
              ] as const
            ).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setLayout(value)}
                aria-label={label}
                title={label}
                className={cn(
                  "rounded-md p-1.5 transition-colors",
                  layout === value
                    ? "bg-cyan-500/15 text-cyan-200"
                    : "text-cyan-100/35 hover:text-cyan-100",
                )}
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {isNamingFolder && (
        <div className="mb-3 flex items-center gap-2">
          <Input
            value={newFolder}
            onChange={(event) => setNewFolder(event.target.value)}
            placeholder="Folder name"
            autoFocus
            className="h-9 max-w-xs"
            onKeyDown={(event) => {
              if (event.key === "Enter" && newFolder.trim()) {
                createFolder.mutate(newFolder.trim());
              }
              if (event.key === "Escape") setIsNamingFolder(false);
            }}
          />
          <Button
            size="sm"
            onClick={() => createFolder.mutate(newFolder.trim())}
            disabled={!newFolder.trim() || createFolder.isPending}
          >
            Create
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIsNamingFolder(false)}
          >
            Cancel
          </Button>
        </div>
      )}

      {listing.isLoading && (
        <div className="flex items-center gap-2 p-6 text-sm text-white/45">
          <Loader2 className="size-4 animate-spin" />
          Reading files…
        </div>
      )}

      {!listing.isLoading && entries.length === 0 && (
        <section className="rounded-2xl border border-dashed border-cyan-500/15 bg-[rgba(6,18,34,0.4)] p-12 text-center">
          <FolderOpen className="mx-auto mb-3 size-7 text-cyan-300/50" />
          <p className="text-sm text-[#7aadb8]">
            {path ? "This folder is empty." : "Nothing in this project yet."}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-4"
            onClick={() => addFiles.mutate()}
          >
            <Upload className="size-3.5" />
            Upload files
          </Button>
        </section>
      )}

      {layout === "grid" && entries.length > 0 && (
        <div className="project-file-grid">
          {entries.map((entry) => {
            const Icon = iconFor(entry);
            return (
              <div
                key={entry.path}
                className="project-file-tile group"
                data-testid={`project-file-${entry.kind}`}
              >
                <button
                  type="button"
                  onDoubleClick={() => open(entry)}
                  onClick={() => open(entry)}
                  className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center"
                >
                  <Icon
                    className={cn(
                      "size-9",
                      entry.kind === "directory"
                        ? "text-cyan-300/80"
                        : "text-cyan-100/35",
                    )}
                  />
                  <span className="w-full truncate text-xs text-cyan-50/85">
                    {entry.name}
                  </span>
                  <span className="text-[10px] text-cyan-100/30">
                    {entry.kind === "directory"
                      ? formatDate(entry.modifiedAt)
                      : formatSize(entry.sizeBytes)}
                  </span>
                </button>
                <div className="project-file-tile-actions">
                  <button
                    type="button"
                    onClick={() => reveal(entry.path)}
                    aria-label={`Show ${entry.name} in Finder`}
                    className="rounded p-1 text-white/35 hover:bg-cyan-500/10 hover:text-cyan-100"
                  >
                    <FolderOpen className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(entry)}
                    aria-label={`Delete ${entry.name}`}
                    className="rounded p-1 text-white/35 hover:bg-rose-500/10 hover:text-rose-300"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {layout === "list" && entries.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-cyan-500/12">
          <div className="flex items-center gap-3 border-b border-cyan-500/10 bg-cyan-950/20 px-3 py-2 text-[10px] uppercase tracking-wider text-cyan-100/35">
            <span className="flex-1">Name</span>
            <span className="w-20 text-right">Size</span>
            <span className="hidden w-28 text-right sm:block">Modified</span>
            <span className="w-16" />
          </div>
          {entries.map((entry) => {
            const Icon = iconFor(entry);
            return (
              <div
                key={entry.path}
                className="flex items-center gap-3 border-b border-cyan-500/8 px-3 py-2.5 text-sm last:border-b-0 hover:bg-cyan-500/8"
                data-testid={`project-file-${entry.kind}`}
              >
                <button
                  type="button"
                  onClick={() => open(entry)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0",
                      entry.kind === "directory"
                        ? "text-cyan-300/80"
                        : "text-cyan-100/35",
                    )}
                  />
                  <span className="truncate text-cyan-50/85">{entry.name}</span>
                </button>
                <span className="w-20 shrink-0 text-right text-xs text-white/30">
                  {formatSize(entry.sizeBytes)}
                </span>
                <span className="hidden w-28 shrink-0 text-right text-xs text-white/25 sm:block">
                  {formatDate(entry.modifiedAt)}
                </span>
                <span className="flex w-16 shrink-0 justify-end gap-1">
                  <button
                    type="button"
                    onClick={() => reveal(entry.path)}
                    aria-label={`Show ${entry.name} in Finder`}
                    className="rounded p-1 text-white/30 hover:bg-cyan-500/10 hover:text-cyan-100"
                  >
                    <FolderOpen className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(entry)}
                    aria-label={`Delete ${entry.name}`}
                    className="rounded p-1 text-white/30 hover:bg-rose-500/10 hover:text-rose-300"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </span>
              </div>
            );
          })}
        </div>
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
