import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface RecordingStorageWarningDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
}

/**
 * Confirmation shown before a recording session starts.
 *
 * Setup clears the preview's cookies and local storage so the recording begins
 * from the signed-out state the generated spec replays from. That is the same
 * browser session the user's own preview uses, so it also drops whatever they
 * had built up there — their preview login, anything the app persisted locally
 * — with no undo. Asking first is the difference between a documented step and
 * a surprise.
 *
 * Each app has its own stable localhost hostname, so this clear is limited to
 * the active app even though all iframe previews share Electron's session.
 */
export function RecordingStorageWarningDialog({
  open,
  onOpenChange,
  onContinue,
}: RecordingStorageWarningDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="recording-storage-warning-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Start recording from a clean slate?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Recording starts from a signed-out browser, so Dyad clears the
            preview's cookies and local storage first. You'll be signed out of
            your preview and anything the app stored there will be gone. Other
            app previews, your app's code, and its database aren't touched.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onContinue}
            data-testid="recording-storage-warning-continue"
          >
            Clear and start recording
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
