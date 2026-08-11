import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  FolderOpen,
  Folder,
  FileText,
  HardDrive,
  Loader2,
  RefreshCw,
} from "lucide-react";

import { ipc } from "@/ipc/types";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import { vaultBreadcrumbs } from "@/lib/vault_paths";
import { showError } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * The local vault, browsable.
 *
 * A file manager for the folder the user connected, so the vault is something
 * they can look inside rather than a path in a settings field.
 *
 * Read only, deliberately. Listing and revealing are safe to get wrong;
 * renaming and deleting are not, and nothing in the app needed them to make
 * the vault legible. The reveal button hands off to the system file browser,
 * which already does the dangerous half properly.
 */

function formatSize(bytes: number | null): string {
  if (bytes === null) return "";
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

export default function LocalStoragePage() {
  const [path, setPath] = useState("");

  const listing = useQuery({
    queryKey: ["vault-directory", path],
    queryFn: () => ipc.storage.listVaultDirectory({ path }),
  });

  const data = listing.data;
  const crumbs = vaultBreadcrumbs(path);

  const reveal = (entryPath: string) => {
    void ipc.storage.revealVaultEntry({ path: entryPath }).catch((error) => {
      showError(
        error instanceof Error ? error.message : "Could not open that item.",
      );
    });
  };

  return (
    <div className="settings-jarvis home-jarvis relative flex min-h-full w-full flex-col overflow-auto bg-background">
      <ParticleBackground className="z-0" />
      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-2.5">
              <div className="manager-brand-icon">
                <HardDrive className="size-4" />
              </div>
              <span className="manager-brand-label font-jarvis-ui">
                LOCAL STORAGE
              </span>
              <div className="manager-status-dot manager-status-dot--active" />
            </div>
            <h1 className="manager-title font-jarvis-display">File Vault</h1>
            <p className="manager-subtitle truncate">
              {data?.vaultPath ?? "No vault connected"}
            </p>
          </div>

          {data?.vaultPath && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void listing.refetch()}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20"
                data-testid="vault-refresh"
              >
                <RefreshCw
                  className={cn("size-4", listing.isFetching && "animate-spin")}
                />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => reveal(path)}
                className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100 hover:bg-cyan-500/20"
                data-testid="vault-reveal-current"
              >
                <FolderOpen className="size-4" />
                Show in Finder
              </button>
            </div>
          )}
        </header>

        {/* No vault is a state, not an error. */}
        {data && !data.vaultPath && (
          <section className="rounded-2xl border border-cyan-500/12 bg-[rgba(6,18,34,0.55)] p-10 text-center">
            <HardDrive className="mx-auto mb-3 size-6 text-cyan-300/70" />
            <p className="text-sm text-[#7aadb8]">
              No local vault is connected. Connect one under System → Machine →
              Storage, and its contents will appear here.
            </p>
          </section>
        )}

        {data?.vaultPath && (
          <>
            <nav
              className="mb-3 flex flex-wrap items-center gap-1 text-xs text-cyan-100/45"
              aria-label="Breadcrumb"
            >
              <button
                type="button"
                onClick={() => setPath("")}
                className="rounded px-1.5 py-0.5 hover:bg-cyan-500/10 hover:text-cyan-100"
              >
                Vault
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

            <section className="overflow-hidden rounded-2xl border border-cyan-500/12 bg-[rgba(6,18,34,0.55)]">
              {listing.isLoading && (
                <div className="flex items-center gap-2 p-6 text-sm text-white/45">
                  <Loader2 className="size-4 animate-spin" />
                  Reading the vault…
                </div>
              )}

              {data.parent !== null && (
                <button
                  type="button"
                  onClick={() => setPath(data.parent ?? "")}
                  className="flex w-full items-center gap-3 border-b border-cyan-500/8 px-4 py-2.5 text-left text-sm text-cyan-100/60 hover:bg-cyan-500/8"
                  data-testid="vault-up"
                >
                  <Folder className="size-4 shrink-0 text-cyan-300/60" />
                  ..
                </button>
              )}

              {data.entries.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-center gap-3 border-b border-cyan-500/8 px-4 py-2.5 text-sm last:border-b-0 hover:bg-cyan-500/8"
                  data-testid={`vault-entry-${entry.kind}`}
                >
                  <button
                    type="button"
                    onClick={() =>
                      entry.kind === "directory"
                        ? setPath(entry.path)
                        : reveal(entry.path)
                    }
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    {entry.kind === "directory" ? (
                      <Folder className="size-4 shrink-0 text-cyan-300/70" />
                    ) : (
                      <FileText className="size-4 shrink-0 text-white/35" />
                    )}
                    <span className="truncate text-cyan-50/85">
                      {entry.name}
                    </span>
                  </button>
                  <span className="shrink-0 text-xs text-white/30">
                    {formatSize(entry.sizeBytes)}
                  </span>
                  <span className="hidden shrink-0 text-xs text-white/25 sm:block">
                    {formatDate(entry.modifiedAt)}
                  </span>
                  <button
                    type="button"
                    onClick={() => reveal(entry.path)}
                    className="shrink-0 rounded-md p-1 text-white/30 hover:bg-cyan-500/10 hover:text-cyan-100"
                    aria-label={`Show ${entry.name} in Finder`}
                  >
                    <FolderOpen className="size-3.5" />
                  </button>
                </div>
              ))}

              {!listing.isLoading &&
                data.entries.length === 0 &&
                data.parent === null && (
                  <p className="p-6 text-sm text-[#7aadb8]">
                    This vault is empty.
                  </p>
                )}
              {!listing.isLoading &&
                data.entries.length === 0 &&
                data.parent !== null && (
                  <p className="p-6 text-sm text-[#7aadb8]">
                    This folder is empty.
                  </p>
                )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
