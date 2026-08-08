import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronRight,
  Cloud,
  Copy,
  Download,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  House,
  Image as ImageIcon,
  Info,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";

import { ipc } from "@/ipc/types";
import { isIpcRendererAvailable } from "@/ipc/contracts/core";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { showError, showSuccess } from "@/lib/toast";
import type { VercelBlobItem } from "@/ipc/types";

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

function baseName(pathname: string): string {
  return pathname.split("/").pop() || pathname;
}

/** Directory prefix of a pathname, including the trailing slash ("" at root). */
function dirName(pathname: string): string {
  const i = pathname.lastIndexOf("/");
  return i >= 0 ? pathname.slice(0, i + 1) : "";
}

function fileExt(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toUpperCase() : "FILE";
}

async function fileToBase64(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  return dataUrl.split(",")[1] ?? "";
}

/**
 * Image thumbnail proxied through the main process. Private Blob stores reject
 * direct <img src> loads, so the bytes are fetched as a data URL instead. Works
 * for public stores too.
 */
function BlobThumb({ url, name }: { url: string; name: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["blobDataUrl", url],
    queryFn: () => ipc.vercelBlob.getDataUrl(url),
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
  if (isLoading) {
    return <Loader2 className="size-5 animate-spin text-cyan-300/40" />;
  }
  if (isError || !data) {
    return <ImageIcon className="size-8 text-white/30" />;
  }
  return (
    <img
      src={data}
      alt={name}
      className="size-full object-cover"
      loading="lazy"
    />
  );
}

export default function MetaHdPage() {
  const queryClient = useQueryClient();
  const hasIpc = isIpcRendererAvailable();

  const statusQuery = useQuery({
    queryKey: ["vercelBlob", "status"],
    queryFn: () => ipc.vercelBlob.status(),
    enabled: hasIpc,
  });
  const connected = statusQuery.data?.connected ?? false;

  const listQuery = useQuery({
    queryKey: ["vercelBlob", "list"],
    queryFn: () => ipc.vercelBlob.list(),
    enabled: hasIpc && connected,
  });
  const blobs = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  // Current folder prefix: "" = root, otherwise ends with "/" (e.g. "images/").
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // New-folder / rename dialog state.
  const [dialog, setDialog] = useState<
    | { kind: "newFolder"; parent: string }
    | { kind: "renameFolder"; folder: string }
    | { kind: "renameFile"; file: VercelBlobItem }
    | null
  >(null);
  const [dialogValue, setDialogValue] = useState("");
  // Properties dialog target.
  const [props, setProps] = useState<
    | { type: "folder"; name: string }
    | { type: "file"; file: VercelBlobItem }
    | null
  >(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["vercelBlob"] });

  const { folders, files } = useMemo(() => {
    const folderSet = new Set<string>();
    const fileItems: VercelBlobItem[] = [];
    for (const b of blobs) {
      if (!b.pathname.startsWith(path)) continue;
      const rest = b.pathname.slice(path.length);
      const slash = rest.indexOf("/");
      if (slash >= 0) {
        folderSet.add(rest.slice(0, slash));
      } else if (rest && rest !== ".keep") {
        fileItems.push(b);
      }
    }
    return {
      folders: [...folderSet].sort((a, b) => a.localeCompare(b)),
      files: fileItems.sort((a, b) => a.pathname.localeCompare(b.pathname)),
    };
  }, [blobs, path]);

  const totalSize = useMemo(
    () => blobs.reduce((s, b) => s + b.size, 0),
    [blobs],
  );
  const fileCount = blobs.filter((b) => !b.pathname.endsWith(".keep")).length;
  const crumbs = path ? path.replace(/\/$/, "").split("/") : [];

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(fileList)) {
        const dataBase64 = await fileToBase64(file);
        await ipc.vercelBlob.upload({
          pathname: `${path}${file.name}`,
          dataBase64,
          contentType: file.type || undefined,
        });
      }
      await refresh();
      showSuccess(`Uploaded ${fileList.length} file(s) to Meta Drive HD`);
    } catch (e) {
      showError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const openNewFolder = (parent: string) => {
    setDialogValue("");
    setDialog({ kind: "newFolder", parent });
  };
  const openRenameFolder = (folder: string) => {
    setDialogValue(folder);
    setDialog({ kind: "renameFolder", folder });
  };
  const openRenameFile = (file: VercelBlobItem) => {
    setDialogValue(baseName(file.pathname));
    setDialog({ kind: "renameFile", file });
  };

  const submitDialog = async () => {
    const name = dialogValue.trim().replace(/\//g, "");
    if (!name || busy || !dialog) return;
    setBusy(true);
    try {
      if (dialog.kind === "newFolder") {
        await ipc.vercelBlob.createFolder(`${dialog.parent}${name}`);
        showSuccess(`Created folder "${name}"`);
      } else if (dialog.kind === "renameFolder") {
        await ipc.vercelBlob.renameFolder({
          from: `${path}${dialog.folder}`,
          to: `${path}${name}`,
        });
        showSuccess(`Renamed to "${name}"`);
      } else if (dialog.kind === "renameFile") {
        // No-op if the name didn't change — copy+delete onto the same path
        // would otherwise destroy the file.
        if (name !== baseName(dialog.file.pathname)) {
          await ipc.vercelBlob.renameFile({
            fromUrl: dialog.file.url,
            toPathname: `${dirName(dialog.file.pathname)}${name}`,
          });
          showSuccess(`Renamed to "${name}"`);
        }
      }
      setDialog(null);
      await refresh();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(false);
    }
  };

  // Aggregate stats for a subfolder of the current path (recursive).
  const folderStats = (name: string) => {
    const prefix = `${path}${name}/`;
    const items = blobs.filter(
      (b) => b.pathname.startsWith(prefix) && baseName(b.pathname) !== ".keep",
    );
    return {
      prefix,
      count: items.length,
      size: items.reduce((s, b) => s + b.size, 0),
    };
  };

  const propsRows = (
    target: typeof props,
  ): [label: string, value: string][] => {
    if (!target) return [];
    if (target.type === "folder") {
      const s = folderStats(target.name);
      return [
        ["Name", target.name],
        ["Kind", "Folder"],
        ["Location", path ? `/${path}` : "Drive root"],
        ["Items", `${s.count} file${s.count === 1 ? "" : "s"}`],
        ["Size", formatSize(s.size)],
        ["Path", `/${s.prefix}`],
      ];
    }
    const f = target.file;
    const dir = dirName(f.pathname);
    return [
      ["Name", baseName(f.pathname)],
      ["Kind", `${fileExt(baseName(f.pathname))} file`],
      ["Size", formatSize(f.size)],
      ["Modified", new Date(f.uploadedAt).toLocaleString()],
      ["Location", dir ? `/${dir}` : "Drive root"],
      ["Path", `/${f.pathname}`],
      ["URL", f.url],
    ];
  };

  const handleDeleteFolder = async (folder: string) => {
    if (
      !window.confirm(
        `Delete folder "${folder}" and everything inside it? This is permanent.`,
      )
    )
      return;
    setBusy(true);
    try {
      await ipc.vercelBlob.deleteFolder(`${path}${folder}`);
      await refresh();
      showSuccess("Folder deleted");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (item: VercelBlobItem) => {
    if (
      !window.confirm(`Delete "${baseName(item.pathname)}"? This is permanent.`)
    )
      return;
    setBusy(true);
    try {
      await ipc.vercelBlob.delete(item.url);
      await refresh();
      showSuccess("Deleted");
    } catch (e) {
      showError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  };

  const copyUrl = async (url: string) => {
    await navigator.clipboard.writeText(url).catch(() => {});
    showSuccess("URL copied");
  };

  // Download via a proxied data URL so it works for private stores too (whose
  // blob URLs require auth and can't be opened directly).
  const download = async (item: VercelBlobItem) => {
    setBusy(true);
    try {
      const dataUrl = await ipc.vercelBlob.getDataUrl(item.url);
      if (!dataUrl) {
        showError("Could not fetch file");
        return;
      }
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = baseName(item.pathname);
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      showError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="agent-os home-jarvis no-app-region-drag relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ParticleBackground className="z-0" />

      {/* Header */}
      <header className="relative z-10 flex flex-wrap items-center gap-3 border-b border-cyan-400/10 bg-[rgba(4,10,22,0.5)] px-5 py-4 backdrop-blur-xl">
        <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-500 to-emerald-400 text-[#04101f] shadow-[0_0_18px_rgba(0,229,255,0.45)]">
          <HardDrive className="size-5" />
        </div>
        <div>
          <h1 className="font-jarvis-display text-lg font-semibold text-white">
            Meta Drive HD
          </h1>
          <p className="font-jarvis-ui text-xs tracking-wide text-white/40">
            Vercel Blob cloud drive · {fileCount} file
            {fileCount === 1 ? "" : "s"} · {formatSize(totalSize)}
          </p>
        </div>
        {connected && (
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => void handleUpload(e.target.files)}
              data-testid="meta-hd-file-input"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-emerald-500 px-3 py-2 text-sm font-medium text-white shadow-[0_0_18px_rgba(0,229,255,0.3)] hover:opacity-90 disabled:opacity-50"
              data-testid="meta-hd-upload"
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Upload
            </button>
            <button
              type="button"
              onClick={() => openNewFolder(path)}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 hover:bg-white/10 disabled:opacity-50"
            >
              <FolderPlus className="size-4" />
              New folder
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              className="grid size-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-white/60 hover:bg-white/10"
              aria-label="Refresh"
            >
              <RefreshCw
                className={cn("size-4", listQuery.isFetching && "animate-spin")}
              />
            </button>
          </div>
        )}
      </header>

      {/* Breadcrumbs */}
      {connected && (
        <div className="relative z-10 flex items-center gap-1 border-b border-white/5 bg-[rgba(4,10,22,0.3)] px-5 py-2 text-sm">
          <button
            type="button"
            onClick={() => setPath("")}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-cyan-200/80 hover:bg-white/5"
          >
            <House className="size-3.5" />
            Drive
          </button>
          {crumbs.map((seg, i) => (
            <span key={i} className="flex items-center gap-1">
              <ChevronRight className="size-3.5 text-white/25" />
              <button
                type="button"
                onClick={() => setPath(crumbs.slice(0, i + 1).join("/") + "/")}
                className="rounded px-1.5 py-0.5 text-white/70 hover:bg-white/5"
              >
                {seg}
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Body */}
      <main className="relative z-10 min-h-0 flex-1 overflow-y-auto p-5">
        {!connected ? (
          <div className="mx-auto mt-16 flex max-w-md flex-col items-center rounded-2xl border border-dashed border-cyan-400/20 bg-[rgba(8,20,40,0.4)] px-6 py-14 text-center">
            <span className="grid size-14 place-items-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300 shadow-[0_0_24px_rgba(0,229,255,0.15)]">
              <Cloud className="size-7" />
            </span>
            <p className="mt-4 font-jarvis-ui text-base font-semibold text-white/85">
              Connect Vercel Blob
            </p>
            <p className="mt-1 text-sm text-white/45">
              Meta Drive HD is your cloud drive for everything the app creates.
              Connect your Blob store in Settings → Connections to get started.
            </p>
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <ContextMenu>
            <ContextMenuTrigger
              render={
                <div className="flex min-h-full items-start justify-center pt-16" />
              }
            >
              <div className="flex max-w-md flex-col items-center rounded-2xl border border-dashed border-cyan-400/15 bg-[rgba(8,20,40,0.35)] px-6 py-14 text-center">
                <span className="grid size-12 place-items-center rounded-2xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300">
                  <Folder className="size-6" />
                </span>
                <p className="mt-4 text-sm text-white/70">
                  This folder is empty
                </p>
                <p className="mt-1 text-xs text-white/40">
                  Right-click to create a folder, or upload files.
                </p>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-44">
              <ContextMenuItem onClick={() => openNewFolder(path)}>
                <FolderPlus className="mr-2 size-4" />
                New folder
              </ContextMenuItem>
              <ContextMenuItem onClick={() => fileInputRef.current?.click()}>
                <Upload className="mr-2 size-4" />
                Upload files
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {folders.map((name) => (
              <ContextMenu key={`folder-${name}`}>
                {/* Card-less folder, Google Drive style. Click to open;
                    right-click for rename / delete. */}
                <ContextMenuTrigger
                  render={
                    <button
                      type="button"
                      onClick={() => setPath(`${path}${name}/`)}
                      className="group flex flex-col items-center gap-1.5 rounded-lg p-3 text-center transition-colors hover:bg-white/[0.06]"
                      data-testid="meta-hd-folder"
                    />
                  }
                >
                  <Folder className="size-14 fill-cyan-400/15 text-cyan-300" />
                  <span className="w-full truncate text-xs font-medium text-white/85">
                    {name}
                  </span>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-44">
                  <ContextMenuItem onClick={() => setPath(`${path}${name}/`)}>
                    <FolderOpen className="mr-2 size-4" />
                    Open
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => openNewFolder(`${path}${name}/`)}
                  >
                    <FolderPlus className="mr-2 size-4" />
                    New folder
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => openRenameFolder(name)}>
                    <Pencil className="mr-2 size-4" />
                    Rename
                  </ContextMenuItem>
                  <ContextMenuItem
                    onClick={() => setProps({ type: "folder", name })}
                  >
                    <Info className="mr-2 size-4" />
                    Properties
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-rose-500 focus:text-rose-500"
                    onClick={() => void handleDeleteFolder(name)}
                  >
                    <Trash2 className="mr-2 size-4" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))}

            {files.map((file) => {
              const name = baseName(file.pathname);
              const isImage = IMAGE_RE.test(name);
              return (
                <ContextMenu key={file.url}>
                  <ContextMenuTrigger
                    render={
                      <div
                        className="group flex flex-col overflow-hidden rounded-2xl border border-cyan-400/12 bg-[rgba(8,20,40,0.5)] backdrop-blur-xl transition-colors hover:border-cyan-400/30"
                        data-testid="meta-hd-file"
                      />
                    }
                  >
                    <div className="grid aspect-video place-items-center overflow-hidden border-b border-white/5 bg-black/30">
                      {isImage ? (
                        <BlobThumb url={file.url} name={name} />
                      ) : (
                        <FileText className="size-8 text-white/30" />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col p-3">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-white">
                        {isImage ? (
                          <ImageIcon className="size-3.5 shrink-0 text-cyan-300" />
                        ) : (
                          <FileText className="size-3.5 shrink-0 text-white/40" />
                        )}
                        <span className="truncate" title={name}>
                          {name}
                        </span>
                      </span>
                      <span className="mt-0.5 text-[11px] text-white/35">
                        {formatSize(file.size)}
                      </span>
                      <div className="mt-2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void download(file)}
                          className="grid size-7 place-items-center rounded-lg border border-white/10 text-white/55 hover:bg-white/5"
                          aria-label="Download"
                          title="Download"
                        >
                          <Download className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void copyUrl(file.url)}
                          className="grid size-7 place-items-center rounded-lg border border-white/10 text-white/55 hover:bg-white/5"
                          aria-label="Copy URL"
                          title="Copy URL"
                        >
                          <Copy className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(file)}
                          className="ml-auto grid size-7 place-items-center rounded-lg border border-white/10 text-rose-300/80 hover:bg-rose-500/10"
                          aria-label="Delete"
                          title="Delete"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-44">
                    <ContextMenuItem onClick={() => void download(file)}>
                      <Download className="mr-2 size-4" />
                      Download
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => void copyUrl(file.url)}>
                      <Copy className="mr-2 size-4" />
                      Copy URL
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => openRenameFile(file)}>
                      <Pencil className="mr-2 size-4" />
                      Rename
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => setProps({ type: "file", file })}
                    >
                      <Info className="mr-2 size-4" />
                      Properties
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      className="text-rose-500 focus:text-rose-500"
                      onClick={() => void handleDelete(file)}
                    >
                      <Trash2 className="mr-2 size-4" />
                      Delete
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        )}
      </main>

      {/* New folder / Rename dialog */}
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent className="w-[92vw] max-w-sm border-cyan-400/15 bg-[#0a1628] text-white">
          <DialogHeader>
            <DialogTitle className="text-white">
              {dialog?.kind === "renameFolder"
                ? "Rename folder"
                : dialog?.kind === "renameFile"
                  ? "Rename file"
                  : "New folder"}
            </DialogTitle>
          </DialogHeader>
          <Input
            autoFocus
            value={dialogValue}
            onChange={(e) => setDialogValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitDialog();
            }}
            placeholder={
              dialog?.kind === "renameFile" ? "File name" : "Folder name"
            }
            className="border-white/10 bg-white/5 text-white"
            data-testid="meta-hd-folder-input"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialog(null)}
              className="border-white/10 text-white/70 hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void submitDialog()}
              disabled={!dialogValue.trim() || busy}
              className="bg-gradient-to-r from-cyan-500 to-emerald-500 text-white hover:opacity-90"
              data-testid="meta-hd-folder-submit"
            >
              {busy && <Loader2 className="mr-2 size-4 animate-spin" />}
              {dialog?.kind === "newFolder" ? "Create" : "Rename"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Properties dialog */}
      <Dialog open={props !== null} onOpenChange={(o) => !o && setProps(null)}>
        <DialogContent className="w-[92vw] max-w-md border-cyan-400/15 bg-[#0a1628] text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Info className="size-4 text-cyan-300" />
              Properties
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm" data-testid="meta-hd-properties">
            {propsRows(props).map(([label, value]) => (
              <div key={label} className="flex gap-3">
                <span className="w-20 shrink-0 text-white/40">{label}</span>
                <span className="min-w-0 break-words text-white/85">
                  {value}
                </span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => setProps(null)}
              className="bg-gradient-to-r from-cyan-500 to-emerald-500 text-white hover:opacity-90"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
