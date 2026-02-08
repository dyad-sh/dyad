import { MessageSquare, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

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
            How would you like to attach{" "}
            {fileCount === 1 ? "this file" : `these ${fileCount} files`}?
          </DialogTitle>
          <DialogDescription>
            Choose how the {fileCount === 1 ? "file" : "files"} should be used.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <button
            className="flex items-start gap-3 rounded-lg border border-border p-4 text-left hover:bg-muted/50 transition-colors"
            onClick={() => onConfirm("chat-context")}
          >
            <MessageSquare
              size={20}
              className="mt-0.5 text-green-500 flex-shrink-0"
            />
            <div>
              <div className="font-medium text-sm">Attach as chat context</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Provide context for the AI (e.g. screenshots, references)
              </div>
            </div>
          </button>
          <button
            className="flex items-start gap-3 rounded-lg border border-border p-4 text-left hover:bg-muted/50 transition-colors"
            onClick={() => onConfirm("upload-to-codebase")}
          >
            <Upload size={20} className="mt-0.5 text-blue-500 flex-shrink-0" />
            <div>
              <div className="font-medium text-sm">Upload to codebase</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Add files to your project (e.g. images, assets)
              </div>
            </div>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
