import type React from "react";
import { useEffect, useRef, useState } from "react";
import { FileText, Image, X, ExternalLink } from "lucide-react";
import { DyadCard, DyadCardHeader, DyadBadge } from "./DyadCardPrimitives";
import { ipc } from "@/ipc/types";
import { toast } from "sonner";

export type AttachmentSize = "sm" | "md" | "lg";

const SIZE_CLASSES: Record<AttachmentSize, string> = {
  sm: "size-14",
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

async function openFile(filePath: string) {
  if (filePath) {
    try {
      await ipc.system.openFilePath(filePath);
    } catch {
      toast.error("Could not open file. It may have been moved or deleted.");
    }
  }
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
  const [isExpanded, setIsExpanded] = useState(false);

  // Reset error state when the image URL changes (e.g., new attachment rendered)
  useEffect(() => {
    setImageError(false);
  }, [url]);

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Lock body scroll and auto-focus close button when lightbox opens
  useEffect(() => {
    if (!isExpanded) return;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = "";
    };
  }, [isExpanded]);

  if (isImage && !imageError && url) {
    return (
      <>
        <div
          className={`relative ${SIZE_CLASSES[size]} rounded-lg overflow-hidden border border-border/60 cursor-pointer hover:brightness-90 transition-all`}
          onClick={() => setIsExpanded(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setIsExpanded(true);
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
        {isExpanded && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
            onClick={() => setIsExpanded(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setIsExpanded(false);
              }
            }}
            role="dialog"
            aria-modal="true"
            aria-label={`Expanded image: ${name}`}
          >
            <div className="absolute top-4 right-4 flex items-center gap-2">
              {filePath && (
                <button
                  className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    openFile(filePath);
                  }}
                  title="Open file"
                  aria-label="Open file"
                >
                  <ExternalLink size={20} />
                </button>
              )}
              <button
                ref={closeButtonRef}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
                onClick={() => setIsExpanded(false)}
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <img
              src={url}
              alt={name}
              className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
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
          {name}
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
