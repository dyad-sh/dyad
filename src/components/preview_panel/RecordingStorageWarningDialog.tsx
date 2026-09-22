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
 * Setup clears the preview's app-scoped cookies and local storage. That is the same
 * browser session the user's own preview uses, so it also drops whatever they
 * had built up there — their preview login, anything the app persisted locally
 * — with no undo. Asking first is the difference between a documented step and
 * a surprise.
 *
 * App hostnames let cleanup leave other previews signed in.
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
            Dyad clears this preview's cookies and local storage before
            recording. This usually signs you out and removes anything the app
            stored in the browser. Other apps' storage is left alone. Shared
            localhost cookies from older Dyad versions are kept and may leave
            you signed in; sign out in the preview first if needed. Your app's
            code and database aren't touched.
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
