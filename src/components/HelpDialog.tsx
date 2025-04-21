import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BookOpenIcon, BugIcon } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";

interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpDialog({ isOpen, onClose }: HelpDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Need help with Dyad?</DialogTitle>
        </DialogHeader>
        <DialogDescription className="">
          If you need assistance or want to report an issue, here are some
          resources:
        </DialogDescription>
        <div className="flex flex-col space-y-4 w-full">
          <div className="flex flex-col space-y-2">
            <Button
              variant="outline"
              onClick={() => {
                IpcClient.getInstance().openExternalUrl(
                  "https://www.dyad.sh/docs"
                );
              }}
              className="w-full py-6 bg-(--background-lightest)"
            >
              <BookOpenIcon className="mr-2 h-5 w-5" /> Open Docs
            </Button>
            <p className="text-sm text-muted-foreground px-2">
              Get help with common questions and issues.
            </p>
          </div>
          <div className="flex flex-col space-y-2">
            <Button
              variant="outline"
              onClick={() =>
                IpcClient.getInstance().openExternalUrl(
                  "https://github.com/dyad-sh/dyad/issues/new"
                )
              }
              className="w-full py-6 bg-(--background-lightest)"
            >
              <BugIcon className="mr-2 h-5 w-5" /> Report a Bug
            </Button>
            <p className="text-sm text-muted-foreground px-2">
              We’ll auto-fill your report with system info and logs. You can
              review it for any sensitive info before submitting.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
