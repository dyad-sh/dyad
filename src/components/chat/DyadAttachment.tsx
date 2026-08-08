import type React from "react";
import { useEffect, useState } from "react";
import { ExternalLink, FileText, Image } from "lucide-react";
import { DyadCard, DyadCardHeader, DyadBadge } from "./DyadCardPrimitives";
import { ImageLightbox, openFile } from "./ImageLightbox";

export type AttachmentSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<AttachmentSize, string> = {
  sm: "size-20",
  md: "size-24",
  lg: "size-40",
};

interface DyadAttachmentProps {
  size?: AttachmentSize;
  node?: {
    properties?: {
      name?: string;
      type?: string;
      url?: string;
      path?: string;
      attachmentType?: string;
    };
  };
}

export const DyadAttachment: React.FC<DyadAttachmentProps> = ({
  node,
  size = "md",
}) => {
  const name = node?.properties?.name || "Untitled";
  const type = node?.properties?.type || "";
  const url = node?.properties?.url || "";
  const filePath = node?.properties?.path || "";
  const attachmentType = node?.properties?.attachmentType || "chat-context";

  const isImage = type.startsWith("image/");
  const accentColor =
    attachmentType === "upload-to-codebase" ? "blue" : "green";
  const [imageError, setImageError] = useState(false);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // Reset error state when the image URL changes (e.g., new attachment rendered)
  useEffect(() => {
    setImageError(false);
  }, [url]);

  if (isImage && !imageError && url) {
    return (
      <>
        <div
          className={`relative ${SIZE_CLASSES[size]} rounded-lg overflow-hidden border border-border/60 cursor-pointer hover:brightness-90 transition-all`}
          onClick={() => setIsLightboxOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsLightboxOpen(true);
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={`Expand image: ${name}`}
          title={name}
        >
          <img
            src={url}
            alt={name}
            className="size-full object-cover"
            onError={() => setImageError(true)}
          />
        </div>
        {isLightboxOpen && (
          <ImageLightbox
            imageUrl={url}
            alt={name}
            filePath={filePath || undefined}
            onClose={() => setIsLightboxOpen(false)}
            onError={() => {
              setImageError(true);
              setIsLightboxOpen(false);
            }}
          />
        )}
      </>
    );
  }

  // Non-image files or image load error fallback
  return (
    <DyadCard
      accentColor={accentColor}
      onClick={filePath ? () => openFile(filePath) : undefined}
    >
      <DyadCardHeader
        icon={isImage ? <Image size={15} /> : <FileText size={15} />}
        accentColor={accentColor}
      >
        <span className="font-medium text-sm text-foreground truncate">
          {imageError ? "Image unavailable" : name}
        </span>
        <DyadBadge color={accentColor}>
          {attachmentType === "upload-to-codebase" ? "Upload" : "Context"}
        </DyadBadge>
        {filePath && (
          <ExternalLink
            size={14}
            className="ml-auto text-muted-foreground shrink-0"
            aria-hidden
          />
        )}
      </DyadCardHeader>
    </DyadCard>
  );
};
