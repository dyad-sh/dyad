import { MessageSquare, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useTranslation } from "react-i18next";

interface FileAttachmentTypeDialogProps {
  pendingFiles: File[] | null;
  onConfirm: (type: "chat-context" | "upload-to-codebase") => void;
  onCancel: () => void;
}

export function FileAttachmentTypeDialog({
  pendingFiles,
  onConfirm,
  onCancel,
}: FileAttachmentTypeDialogProps) {
  const { t } = useTranslation("chat");
  const isOpen = !!pendingFiles && pendingFiles.length > 0;
  const fileCount = pendingFiles?.length ?? 0;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {fileCount === 1
              ? t("attachmentTypeDialog.titleSingular")
              : t("attachmentTypeDialog.titlePlural", { count: fileCount })}
          </DialogTitle>
          <DialogDescription>
            {fileCount === 1
              ? t("attachmentTypeDialog.descriptionSingular")
              : t("attachmentTypeDialog.descriptionPlural")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="flex items-start gap-3 rounded-lg border border-border p-4 text-left hover:bg-muted/50 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => onConfirm("chat-context")}
          >
            <MessageSquare
              size={20}
              className="mt-0.5 text-green-500 flex-shrink-0"
            />
            <div>
              <div className="font-medium text-sm">
                {t("attachFileContext")}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t("attachFileContextExample")}
              </div>
            </div>
          </button>
          <button
            type="button"
            className="flex items-start gap-3 rounded-lg border border-border p-4 text-left hover:bg-muted/50 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => onConfirm("upload-to-codebase")}
          >
            <Upload size={20} className="mt-0.5 text-blue-500 flex-shrink-0" />
            <div>
              <div className="font-medium text-sm">
                {t("uploadFileCodebase")}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {t("uploadFileCodebaseExample")}
              </div>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
