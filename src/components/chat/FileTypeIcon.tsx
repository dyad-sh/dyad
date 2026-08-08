import { Loader2 } from "lucide-react";

import {
  describeFileType,
  fileBadgeLabel,
  formatFileSize,
} from "@/lib/file_type_icon";
import { cn } from "@/lib/utils";

/**
 * The icon shown for an attached file: a tinted tile carrying the icon for its
 * kind, with the extension as a small badge.
 *
 * Images get a thumbnail instead when one is available — the picture itself is
 * more informative than any icon of a picture.
 */
export function FileTypeIcon({
  fileName,
  mimeType,
  previewUrl,
  uploading = false,
  size = "md",
  className,
}: {
  fileName: string;
  mimeType?: string;
  previewUrl?: string;
  uploading?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  const descriptor = describeFileType(fileName, mimeType);
  const Icon = descriptor.icon;
  const badge = fileBadgeLabel(fileName);
  const tile = size === "sm" ? "size-7 rounded-lg" : "size-10 rounded-xl";

  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden",
        tile,
        previewUrl ? "bg-black/20" : descriptor.className,
        className,
      )}
      data-testid="file-type-icon"
      data-file-kind={descriptor.kind}
      aria-hidden
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt=""
          className="size-full object-cover"
          draggable={false}
        />
      ) : (
        <Icon className={size === "sm" ? "size-3.5" : "size-5"} />
      )}

      {badge && size === "md" && !previewUrl && (
        <span className="absolute bottom-0 inset-x-0 bg-black/45 text-center text-[8px] font-semibold leading-[11px] tracking-wide text-white/85">
          {badge}
        </span>
      )}

      {uploading && (
        <span
          className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[1px]"
          data-testid="file-type-icon-uploading"
        >
          <Loader2
            className={cn(
              "animate-spin text-white",
              size === "sm" ? "size-3" : "size-4",
            )}
          />
        </span>
      )}

      {/* A sweep across the tile, so a large file still looks like it is
          moving even before any bytes are read. */}
      {uploading && (
        <span className="file-upload-shimmer pointer-events-none absolute inset-0" />
      )}
    </span>
  );
}

/** Icon, name and size — the whole attachment, as shown in a chat bubble. */
export function FileTypeCard({
  fileName,
  mimeType,
  sizeBytes,
  previewUrl,
  uploading,
  className,
}: {
  fileName: string;
  mimeType?: string;
  sizeBytes?: number;
  previewUrl?: string;
  uploading?: boolean;
  className?: string;
}) {
  const descriptor = describeFileType(fileName, mimeType);
  const size =
    typeof sizeBytes === "number" ? formatFileSize(sizeBytes) : undefined;

  return (
    <div
      className={cn("chat-file-card", className)}
      title={fileName}
      data-testid="file-type-card"
    >
      <FileTypeIcon
        fileName={fileName}
        mimeType={mimeType}
        previewUrl={previewUrl}
        uploading={uploading}
      />
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground/90">
          {fileName}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {uploading
            ? "Uploading…"
            : [descriptor.label, size].filter(Boolean).join(" · ")}
        </p>
      </div>
    </div>
  );
}
