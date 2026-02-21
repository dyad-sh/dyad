import type React from "react";
import { useState } from "react";
import { FileText, Image, X, ExternalLink } from "lucide-react";
import { DyadCard, DyadCardHeader, DyadBadge } from "./DyadCardPrimitives";
import { ipc } from "@/ipc/types";

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

function openFile(filePath: string) {
  if (filePath) {
    ipc.system.openFilePath(filePath);
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

  if (isImage && !imageError && url) {
    return (
      <>
        <div
          className={`relative ${SIZE_CLASSES[size]} rounded-lg overflow-hidden border border-border/60 cursor-pointer hover:brightness-90 transition-all`}
          onClick={() => setIsExpanded(true)}
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
          >
            <div className="absolute top-4 right-4 flex items-center gap-2">
              {filePath && (
                <button
                  className="text-white hover:text-gray-300 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    openFile(filePath);
                  }}
                  title="Open file"
                >
                  <ExternalLink size={22} />
                </button>
              )}
              <button
                className="text-white hover:text-gray-300 cursor-pointer"
                onClick={() => setIsExpanded(false)}
              >
                <X size={24} />
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
      </DyadCardHeader>
    </DyadCard>
  );
};
