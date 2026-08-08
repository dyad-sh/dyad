import { X } from "lucide-react";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";

import { chatAgentAttachmentsAtom } from "@/atoms/chatAgentAtoms";
import { FileTypeIcon } from "@/components/chat/FileTypeIcon";
import { formatFileSize } from "@/lib/file_type_icon";
import { useImagePreviews } from "@/hooks/useImagePreviews";

export function ChatAgentAttachmentsList() {
  const { t } = useTranslation("chat");
  const [attachments, setAttachments] = useAtom(chatAgentAttachmentsAtom);
  const files = attachments.map((attachment) => attachment.file);
  const previews = useImagePreviews(files);

  if (attachments.length === 0) return null;

  return (
    <div
      className="chat-agent-attachments"
      data-testid="chat-agent-attachments"
    >
      {attachments.map((attachment, index) => {
        const { file } = attachment;
        // An image only has a preview once its object URL exists; until then
        // the tile shows the uploading state rather than an empty box.
        const previewUrl = previews.get(file);
        const pending = file.type.startsWith("image/") && !previewUrl;

        return (
          <div
            key={`${file.name}-${index}`}
            className="chat-agent-attachment-chip"
            title={`${file.name} (${formatFileSize(file.size)})`}
          >
            <FileTypeIcon
              fileName={file.name}
              mimeType={file.type}
              previewUrl={previewUrl}
              uploading={pending}
              size="sm"
            />
            <span className="truncate max-w-[140px]">{file.name}</span>
            <button
              type="button"
              className="chat-agent-attachment-remove"
              aria-label={t("removeAttachment")}
              onClick={() =>
                setAttachments((prev) => prev.filter((_, i) => i !== index))
              }
            >
              <X className="size-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
