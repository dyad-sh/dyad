import { FileText, X, MessageSquare, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import type { FileAttachment } from "@/ipc/types";
import { useTranslation } from "react-i18next";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip";

interface AttachmentsListProps {
  attachments: FileAttachment[];
  onRemove: (index: number) => void;
}

function ImageAttachmentThumbnail({ file }: { file: File }) {
  // Create the object URL inside the effect and revoke the same URL in its
  // cleanup. This keeps a single shared URL valid for both the thumbnail and
  // the hover preview (no leak on quick hover), while staying correct under
  // React StrictMode's mount/unmount/remount cycle — each setup creates a
  // fresh URL that its own cleanup revokes, so the rendered src is never stale.
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!objectUrl) return null;

  return (
    <Tooltip>
      <TooltipTrigger render={<div className="flex" />}>
        <img
          src={objectUrl}
          alt={file.name}
          className="w-12 h-12 object-cover rounded-md"
        />
      </TooltipTrigger>
      <TooltipContent className="bg-transparent p-0 [&_[data-slot=tooltip-arrow]]:hidden">
        <img
          src={objectUrl}
          alt={file.name}
          className="max-w-[200px] max-h-[200px] object-contain bg-background p-1 rounded shadow-lg"
        />
      </TooltipContent>
    </Tooltip>
  );
}

export function AttachmentsList({
  attachments,
  onRemove,
}: AttachmentsListProps) {
  const { t } = useTranslation("chat");

  if (attachments.length === 0) return null;

  return (
    <div className="px-2 pt-2 flex flex-wrap gap-1 max-h-32 overflow-y-auto">
      {attachments.map((attachment, index) => (
        <div
          key={index}
          className="flex items-center bg-muted rounded-md px-2 py-1 text-xs gap-1"
          title={t("attachmentSize", {
            name: attachment.file.name,
            size: (attachment.file.size / 1024).toFixed(1),
          })}
        >
          <div className="flex items-center gap-1">
            {attachment.type === "upload-to-codebase" ? (
              <Upload size={12} className="text-blue-600" />
            ) : (
              <MessageSquare size={12} className="text-green-600" />
            )}
            {attachment.file.type.startsWith("image/") ? (
              <ImageAttachmentThumbnail file={attachment.file} />
            ) : (
              <FileText size={12} />
            )}
          </div>
          <span className="truncate max-w-[120px]">{attachment.file.name}</span>
          <button
            onClick={() => onRemove(index)}
            className="hover:bg-muted-foreground/20 rounded-full p-0.5"
            aria-label={t("removeAttachment")}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
