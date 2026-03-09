import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface MacNotificationGuideDialogProps {
  open: boolean;
  onClose: () => void;
}

export function MacNotificationGuideDialog({
  open,
  onClose,
}: MacNotificationGuideDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Allow Notifications on macOS</DialogTitle>
          <DialogDescription>
            If you didn't receive a test notification, you may need to allow
            notifications for Dyad in macOS. Here are two ways to do it:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg border p-3 space-y-1">
            <h4 className="text-sm font-medium">
              Option 1: From the Notification Permission Prompt
            </h4>
            <p className="text-sm text-muted-foreground">
              Click the <strong>"Options"</strong> dropdown on the notification
              and select <strong>"Allow"</strong>.
            </p>
          </div>

          <div className="rounded-lg border p-3 space-y-1">
            <h4 className="text-sm font-medium">Option 2: System Settings</h4>
            <p className="text-sm text-muted-foreground">
              Open{" "}
              <strong>
                System Settings → Notifications → Application Notifications →
                Dyad
              </strong>{" "}
              and enable <strong>"Allow Notifications"</strong>.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button onClick={onClose}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
