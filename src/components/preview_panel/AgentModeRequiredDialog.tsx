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

interface AgentModeRequiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContinue: () => void;
  action: "generate" | "fix";
}

/**
 * Confirmation shown when the user triggers "Generate test" / "Fix with AI"
 * while the current chat isn't in Agent mode. Writing and fixing tests happens
 * in Agent mode (it edits files and runs tests), so Continue sends the request
 * in Agent mode regardless of the chat's current mode.
 */
export function AgentModeRequiredDialog({
  open,
  onOpenChange,
  onContinue,
  action,
}: AgentModeRequiredDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="agent-mode-required-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Switch to Agent mode?</AlertDialogTitle>
          <AlertDialogDescription>
            {action === "generate"
              ? "Generating an end-to-end test runs in Agent mode, which can explore your app, write the test, run it, and fix failures. Continue will send this request in Agent mode."
              : "Fixing a failing test runs in Agent mode, which can edit files and run your tests to verify the fix. Continue will send this request in Agent mode."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onContinue}
            data-testid="agent-mode-continue"
          >
            Continue in Agent mode
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
