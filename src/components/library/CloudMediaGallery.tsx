import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Cloud,
  FileVideo,
  Image as ImageIcon,
  Loader2,
  Play,
} from "lucide-react";

import { ipc } from "@/ipc/types";
import { isIpcRendererAvailable } from "@/ipc/contracts/core";
import type { VercelBlobItem } from "@/ipc/types";

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

function CloudImageCard({ item }: { item: VercelBlobItem }) {
  const name = baseName(item.pathname);
  const { data, isLoading, isError } = useBlobDataUrl(item.url);
  return (
    <div className="group overflow-hidden rounded-lg border bg-card">
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
      <div className="p-2">
        <p className="truncate text-sm font-medium" title={name}>
          {name}
        </p>
        <p className="text-xs text-muted-foreground">{formatSize(item.size)}</p>
      </div>
    </div>
  );
}

function CloudVideoCard({ item }: { item: VercelBlobItem }) {
  const name = baseName(item.pathname);
  // Videos can be large, so only fetch the bytes once the user hits play.
  const [play, setPlay] = useState(false);
  const { data, isLoading, isError } = useBlobDataUrl(item.url, play);
  return (
    <div className="group overflow-hidden rounded-lg border bg-card">
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
      <div className="p-2">
        <p className="truncate text-sm font-medium" title={name}>
          {name}
        </p>
        <p className="text-xs text-muted-foreground">{formatSize(item.size)}</p>
      </div>
    </div>
  );
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i;

/**
 * Gallery of cloud media: reads the Vercel Blob `images/` or `videos/` folder
 * and renders thumbnails. Images load eagerly; videos play on click.
 */
export function CloudMediaGallery({
  kind,
  searchQuery,
}: {
  kind: "images" | "videos";
  searchQuery: string;
}) {
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

  const prefix = `${kind}/`;
  const q = searchQuery.trim().toLowerCase();
  const items = (listQuery.data ?? [])
    .filter(
      (b) => b.pathname.startsWith(prefix) && baseName(b.pathname) !== ".keep",
    )
    .filter((b) => !q || baseName(b.pathname).toLowerCase().includes(q))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  if (!connected) {
    return (
      <div className="mx-auto mt-6 flex max-w-md flex-col items-center rounded-lg border border-dashed px-6 py-12 text-center">
        <Cloud className="mb-3 h-8 w-8 text-muted-foreground" />
        <p className="font-medium">Connect your cloud drive</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {kind === "images" ? "Generated images" : "Generated videos"} are
          stored in your Vercel Blob <code>{kind}/</code> folder. Connect it in
          Settings → Connections to see them here.
        </p>
      </div>
    );
  }

  if (listQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        {q
          ? "No results found."
          : kind === "images"
            ? "No images in your cloud drive yet."
            : "No videos in your cloud drive yet."}
      </div>
    );
  }

  return (
    <div
      data-testid={`cloud-${kind}-grid`}
      className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4"
    >
      {items.map((item) =>
        kind === "images" || IMAGE_RE.test(baseName(item.pathname)) ? (
          <CloudImageCard key={item.url} item={item} />
        ) : (
          <CloudVideoCard key={item.url} item={item} />
        ),
      )}
    </div>
  );
}
