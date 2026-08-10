import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Cloud,
  FileVideo,
  HardDrive,
  Image as ImageIcon,
  Loader2,
  Play,
} from "lucide-react";

import { ipc } from "@/ipc/types";
import { isIpcRendererAvailable } from "@/ipc/contracts/core";
import type { LocalMediaItem, VercelBlobItem } from "@/ipc/types";
import { useLocalMedia } from "@/hooks/useLocalMedia";

function baseName(pathname: string): string {
  return pathname.split("/").pop() || pathname;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Proxy a blob through the main process — private stores can't be loaded via a
 * direct URL, so the bytes come back as a data URL. */
function useBlobDataUrl(url: string, enabled = true) {
  return useQuery({
    queryKey: ["blobDataUrl", url],
    queryFn: () => ipc.vercelBlob.getDataUrl(url),
    enabled,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });
}

function CardShell({
  name,
  sizeBytes,
  label,
  children,
}: {
  name: string;
  sizeBytes: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="group overflow-hidden rounded-lg border bg-card">
      {children}
      <div className="p-2">
        <p className="truncate text-sm font-medium" title={name}>
          {name}
        </p>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {formatSize(sizeBytes)}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={label}>
            {label}
          </p>
        </div>
      </div>
    </div>
  );
}

function LocalImageCard({ item }: { item: LocalMediaItem }) {
  const [errored, setErrored] = useState(false);
  return (
    <CardShell
      name={item.fileName}
      sizeBytes={item.sizeBytes}
      label={item.sourceLabel}
    >
      <div className="grid aspect-square place-items-center overflow-hidden bg-muted">
        {errored ? (
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        ) : (
          <img
            src={item.url}
            alt={item.fileName}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setErrored(true)}
          />
        )}
      </div>
    </CardShell>
  );
}

function LocalVideoCard({ item }: { item: LocalMediaItem }) {
  return (
    <CardShell
      name={item.fileName}
      sizeBytes={item.sizeBytes}
      label={item.sourceLabel}
    >
      <div className="grid aspect-square place-items-center overflow-hidden bg-black">
        {/* Local files stream straight off disk, so no click-to-load needed. */}
        <video
          src={item.url}
          controls
          preload="metadata"
          playsInline
          className="h-full w-full object-contain"
        />
      </div>
    </CardShell>
  );
}

function CloudImageCard({ item }: { item: VercelBlobItem }) {
  const name = baseName(item.pathname);
  const { data, isLoading, isError } = useBlobDataUrl(item.url);
  return (
    <CardShell name={name} sizeBytes={item.size} label="Cloud">
      <div className="grid aspect-square place-items-center overflow-hidden bg-muted">
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : isError || !data ? (
          <ImageIcon className="h-8 w-8 text-muted-foreground" />
        ) : (
          <img
            src={data}
            alt={name}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        )}
      </div>
    </CardShell>
  );
}

function CloudVideoCard({ item }: { item: VercelBlobItem }) {
  const name = baseName(item.pathname);
  // Videos can be large, so only fetch the bytes once the user hits play.
  const [play, setPlay] = useState(false);
  const { data, isLoading, isError } = useBlobDataUrl(item.url, play);
  return (
    <CardShell name={name} sizeBytes={item.size} label="Cloud">
      <div className="relative grid aspect-square place-items-center overflow-hidden bg-black">
        {play ? (
          isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-white/60" />
          ) : isError || !data ? (
            <FileVideo className="h-8 w-8 text-white/40" />
          ) : (
            <video
              src={data}
              controls
              autoPlay
              playsInline
              className="h-full w-full object-contain"
            />
          )
        ) : (
          <button
            type="button"
            onClick={() => setPlay(true)}
            className="grid h-full w-full place-items-center"
            aria-label={`Play ${name}`}
          >
            <FileVideo className="h-10 w-10 text-white/30" />
            <span className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
              <span className="grid size-11 place-items-center rounded-full bg-black/60 text-white backdrop-blur">
                <Play className="size-5 translate-x-0.5" />
              </span>
            </span>
          </button>
        )}
      </div>
    </CardShell>
  );
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

type GalleryEntry =
  | { key: string; sortAt: number; origin: "local"; item: LocalMediaItem }
  | {
      key: string;
      sortAt: number;
      origin: "cloud";
      item: VercelBlobItem;
      isImage: boolean;
    };

/**
 * Gallery for the Library's Images and Videos tabs. Local media is always
 * shown — the file vault and each app's media folder — and cloud media from
 * Vercel Blob is merged in when a cloud drive is connected.
 */
export function MediaGallery({
  kind,
  searchQuery,
}: {
  kind: "images" | "videos";
  searchQuery: string;
}) {
  const hasIpc = isIpcRendererAvailable();
  const {
    items: localItems,
    vaultPath,
    isLoading: localLoading,
  } = useLocalMedia();

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

  const q = searchQuery.trim().toLowerCase();
  const wantedKind = kind === "images" ? "image" : "video";

  const entries = useMemo<GalleryEntry[]>(() => {
    const local: GalleryEntry[] = localItems
      .filter((item) => item.kind === wantedKind)
      .filter((item) => !q || item.fileName.toLowerCase().includes(q))
      .map((item) => ({
        key: item.id,
        sortAt: item.modifiedAt,
        origin: "local" as const,
        item,
      }));

    const prefix = `${kind}/`;
    const cloud: GalleryEntry[] = (listQuery.data ?? [])
      .filter(
        (b) =>
          b.pathname.startsWith(prefix) && baseName(b.pathname) !== ".keep",
      )
      .filter((b) => !q || baseName(b.pathname).toLowerCase().includes(q))
      .map((b) => ({
        key: b.url,
        sortAt: new Date(b.uploadedAt).getTime() || 0,
        origin: "cloud" as const,
        item: b,
        isImage: kind === "images" || IMAGE_RE.test(baseName(b.pathname)),
      }));

    return [...local, ...cloud].sort((a, b) => b.sortAt - a.sortAt);
  }, [localItems, listQuery.data, kind, wantedKind, q]);

  const isLoading = localLoading || (connected && listQuery.isLoading);

  if (isLoading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="mx-auto mt-6 flex max-w-md flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
        {q ? (
          <p className="text-muted-foreground">No results found.</p>
        ) : (
          <>
            <HardDrive className="mb-3 h-8 w-8 text-muted-foreground" />
            <p className="font-medium">
              No {kind === "images" ? "images" : "videos"} yet
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {vaultPath
                ? `Anything in your vault's Media/${kind === "images" ? "Images" : "Videos"} folder shows up here, along with media from your apps.`
                : "Set up a local file vault in Settings → Storage to keep generated media on this machine."}
            </p>
            {!connected && (
              <p className="mt-3 text-xs text-muted-foreground">
                Connect a cloud drive in Settings → Connections to also see
                media stored there.
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div>
      <div
        data-testid={`media-${kind}-grid`}
        className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4"
      >
        {entries.map((entry) =>
          entry.origin === "local" ? (
            entry.item.kind === "image" ? (
              <LocalImageCard key={entry.key} item={entry.item} />
            ) : (
              <LocalVideoCard key={entry.key} item={entry.item} />
            )
          ) : entry.isImage ? (
            <CloudImageCard key={entry.key} item={entry.item} />
          ) : (
            <CloudVideoCard key={entry.key} item={entry.item} />
          ),
        )}
      </div>

      {!connected && (
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Cloud className="h-3.5 w-3.5" />
          Showing local media only. Connect a cloud drive in Settings →
          Connections to include cloud files.
        </p>
      )}
    </div>
  );
}
