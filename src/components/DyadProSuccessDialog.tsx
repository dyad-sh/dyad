import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle, Sparkles } from "lucide-react";

interface DyadProSuccessDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DyadProSuccessDialog({
  isOpen,
  onClose,
}: DyadProSuccessDialogProps) {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900">
              <CheckCircle className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <span>Features Enabled</span>
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="mb-4 text-base">
            All JoyCreate features are now ready to use!
          </p>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-5 w-5 text-indigo-500" />
            <p className="text-sm">You have access to all AI models and features.</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Click the Features button at the top to access settings at any time.
          </p>
        </div>
        <DialogFooter className="flex justify-end gap-2">
          <Button onClick={onClose} variant="outline">
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
