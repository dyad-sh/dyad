import { MessageSquare, Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface AttachmentTypeDialogProps {
  open: boolean;
  files: File[];
  onSelect: (type: "chat-context" | "upload-to-codebase") => void;
  onCancel: () => void;
}

export function AttachmentTypeDialog({
  open,
  files,
  onSelect,
  onCancel,
}: AttachmentTypeDialogProps) {
  const fileCount = files.length;
  const fileNames = files.map((f) => f.name).join(", ");
  const truncatedNames =
    fileNames.length > 50 ? fileNames.slice(0, 50) + "..." : fileNames;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>How do you want to use this file?</DialogTitle>
          <DialogDescription>
            {fileCount === 1 ? (
              <span className="font-medium">{truncatedNames}</span>
            ) : (
              <span>
                <span className="font-medium">{fileCount} files</span>:{" "}
                {truncatedNames}
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 mt-2">
          <Button
            variant="outline"
            className="h-auto py-4 px-4 justify-start gap-3"
            onClick={() => onSelect("chat-context")}
            data-testid="attachment-type-chat-context"
          >
            <MessageSquare size={20} className="text-green-600 flex-shrink-0" />
            <div className="flex flex-col items-start text-left">
              <span className="font-medium">Attach as chat context</span>
              <span className="text-xs text-muted-foreground">
                For AI to analyze (e.g., screenshot showing a UI issue)
              </span>
            </div>
          </Button>
          <Button
            variant="outline"
            className="h-auto py-4 px-4 justify-start gap-3"
            onClick={() => onSelect("upload-to-codebase")}
            data-testid="attachment-type-upload-to-codebase"
          >
            <Upload size={20} className="text-blue-600 flex-shrink-0" />
            <div className="flex flex-col items-start text-left">
              <span className="font-medium">Upload to codebase</span>
              <span className="text-xs text-muted-foreground">
                Add as a project asset (e.g., logo, image for the app)
              </span>
            </div>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
