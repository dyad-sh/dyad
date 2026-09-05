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
import {
  BACKEND_SWITCH_CANCEL_LABEL,
  BACKEND_SWITCH_REQUIRES_NEW_CHAT_MESSAGE,
  BACKEND_SWITCH_START_NEW_CHAT_LABEL,
} from "@/shared/chat_backend";

interface BackendSwitchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Human-readable target, e.g. "Claude Code (Claude Opus)". */
  targetLabel: string;
  onStartNewChat: () => void;
  isStarting?: boolean;
}

/**
 * Shown when a model selection would move an existing chat to a different
 * execution backend. The current chat is never switched or cleared; the user
 * either starts a new chat with the chosen backend or cancels.
 */
export function BackendSwitchDialog({
  open,
  onOpenChange,
  targetLabel,
  onStartNewChat,
  isStarting = false,
}: BackendSwitchDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="backend-switch-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Switch to {targetLabel}?</AlertDialogTitle>
          <AlertDialogDescription>
            {BACKEND_SWITCH_REQUIRES_NEW_CHAT_MESSAGE}
            <br />
            <br />
            The new chat starts in this app with {targetLabel}. Your previous
            conversation is not carried over automatically.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="backend-switch-cancel">
            {BACKEND_SWITCH_CANCEL_LABEL}
          </AlertDialogCancel>
          <AlertDialogAction
            data-testid="backend-switch-start-new-chat"
            disabled={isStarting}
            onClick={(event) => {
              event.preventDefault();
              onStartNewChat();
            }}
          >
            {BACKEND_SWITCH_START_NEW_CHAT_LABEL}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
