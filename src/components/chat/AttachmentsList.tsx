import { X, MessageSquare, Upload } from "lucide-react";
import type { FileAttachment } from "@/ipc/types";
import { useTranslation } from "react-i18next";

import { FileTypeIcon } from "./FileTypeIcon";
import { useImagePreviews } from "@/hooks/useImagePreviews";

interface AttachmentsListProps {
  attachments: FileAttachment[];
  onRemove: (index: number) => void;
}

export function AttachmentsList({
  attachments,
  onRemove,
}: AttachmentsListProps) {
  const { t } = useTranslation("chat");
  const previews = useImagePreviews(
    attachments.map((attachment) => attachment.file),
  );

  if (attachments.length === 0) return null;

  return (
    <div className="px-2 pt-2 flex flex-wrap gap-1">
      {attachments.map((attachment, index) => (
        <div
          key={index}
          className="flex items-center bg-muted rounded-md px-2 py-1 text-xs gap-1"
          title={`${attachment.file.name} (${(attachment.file.size / 1024).toFixed(1)}KB)`}
        >
          <div className="flex items-center gap-1">
            {attachment.type === "upload-to-codebase" ? (
              <Upload size={12} className="text-blue-600" />
            ) : (
              <MessageSquare size={12} className="text-green-600" />
            )}
            <FileTypeIcon
              fileName={attachment.file.name}
              mimeType={attachment.file.type}
              previewUrl={previews.get(attachment.file)}
              uploading={
                attachment.file.type.startsWith("image/") &&
                !previews.has(attachment.file)
              }
              size="sm"
            />
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
