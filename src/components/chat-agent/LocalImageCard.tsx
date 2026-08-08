import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Expand, FolderOpen, Loader2 } from "lucide-react";

import { ipc } from "@/ipc/types";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Renders an image an agent wrote to disk, given its path: a thumbnail rather
 * than the raw path, with a way to reveal it in Finder.
 */
export function LocalImageCard({
  path,
  onPreview,
  className,
}: {
  path: string;
  onPreview?: (dataUrl: string) => void;
  className?: string;
}) {
  const query = useQuery({
    queryKey: ["local-image", path],
    queryFn: () => ipc.system.readLocalImage({ path }),
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const name = path.split("/").pop() || path;
  // "No longer exists" here almost always means the file was written on the
  // agent's host rather than this one.
  const isMissing =
    query.isError &&
    query.error instanceof Error &&
    /no longer exists/i.test(query.error.message);

  return (
    <figure
      className={cn("chat-agent-image-card chat-card-fly-in", className)}
      data-testid="local-image-card"
    >
      {query.isLoading && (
        <div className="flex h-40 items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading image…
        </div>
      )}

      {query.isError && (
        <div className="flex h-40 flex-col items-center justify-center gap-1.5 px-3 text-center">
          <AlertTriangle className="size-4 text-amber-400/80" />
          <span className="text-xs text-muted-foreground">
            {isMissing
              ? "This image is on the agent's machine, not yours."
              : query.error instanceof Error
                ? query.error.message
                : "Could not open that image."}
          </span>
          {isMissing && (
            <span className="text-[11px] text-muted-foreground/70">
              Ask the agent to send the image itself rather than a file path.
            </span>
          )}
          <span className="max-w-full truncate font-mono text-[10px] text-muted-foreground/70">
            {path}
          </span>
        </div>
      )}

      {query.data && (
        <button
          type="button"
          className="chat-agent-image-preview-trigger"
          onClick={() => onPreview?.(query.data.dataUrl)}
          aria-label={`Preview ${name}`}
        >
          <img
            src={query.data.dataUrl}
            alt={name}
            className="chat-agent-image"
          />
          <span className="chat-agent-image-preview-hint">
            <Expand className="size-4" />
            Preview
          </span>
        </button>
      )}

      <figcaption className="chat-agent-image-card-footer">
        <span className="min-w-0 flex-1 truncate" title={path}>
          {name}
          {query.data && (
            <span className="ml-2 text-muted-foreground/70">
              {formatBytes(query.data.sizeBytes)}
            </span>
          )}
        </span>
        {/* Revealing a path that is not on this machine would just fail. */}
        {!isMissing && (
          <button
            type="button"
            onClick={() => void ipc.system.showItemInFolder(path)}
            className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition hover:bg-foreground/10 hover:text-foreground"
            aria-label={`Show ${name} in Finder`}
            data-testid="local-image-reveal"
          >
            <FolderOpen className="size-3.5" />
            Open location
          </button>
        )}
      </figcaption>
    </figure>
  );
}
