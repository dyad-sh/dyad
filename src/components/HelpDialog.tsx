import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BugIcon } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { useState } from "react";
import { HelpBotDialog } from "./HelpBotDialog";
import { BugScreenshotDialog } from "./BugScreenshotDialog";

interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpDialog({ isOpen, onClose }: HelpDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isHelpBotOpen, setIsHelpBotOpen] = useState(false);
  const [isBugScreenshotOpen, setIsBugScreenshotOpen] = useState(false);

  const handleClose = () => {
    onClose();
  };

  const handleReportBug = async () => {
    setIsLoading(true);
    try {
      // Get system debug info
      const debugInfo = await IpcClient.getInstance().getSystemDebugInfo();

      // Create a formatted issue body with the debug info
      const issueBody = `
<!-- Please fill in all fields in English -->

## Bug Description (required)
<!-- Please describe the issue you're experiencing and how to reproduce it -->

## Screenshot (recommended)
<!-- Screenshot of the bug -->

## System Information
- ABBA AI Version: ${debugInfo.dyadVersion}
- Platform: ${debugInfo.platform}
- Architecture: ${debugInfo.architecture}
- Node Version: ${debugInfo.nodeVersion || "n/a"}
- PNPM Version: ${debugInfo.pnpmVersion || "n/a"}
- Node Path: ${debugInfo.nodePath || "n/a"}
- Telemetry ID: ${debugInfo.telemetryId || "n/a"}
- Model: ${debugInfo.selectedLanguageModel || "n/a"}

## Logs
\`\`\`
${debugInfo.logs.slice(-3_500) || "No logs available"}
\`\`\`
`;

      // Create the GitHub issue URL with the pre-filled body
      const encodedBody = encodeURIComponent(issueBody);
      const encodedTitle = encodeURIComponent("[bug] <WRITE TITLE HERE>");
      const labels = ["bug"];
      const githubIssueUrl = `https://github.com/yosiwizman/dyad/issues/new?title=${encodedTitle}&labels=${labels}&body=${encodedBody}`;

      // Open the pre-filled GitHub issue page
      IpcClient.getInstance().openExternalUrl(githubIssueUrl);
    } catch (error) {
      console.error("Failed to prepare bug report:", error);
      // Fallback to opening the regular GitHub issue page
      IpcClient.getInstance().openExternalUrl(
        "https://github.com/yosiwizman/dyad/issues/new",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Need help with ABBA AI?</DialogTitle>
        </DialogHeader>
        <DialogDescription className="">
          If you need help or want to report an issue:
        </DialogDescription>
        <div className="flex flex-col space-y-4 w-full">
          <div className="flex flex-col space-y-2">
            <Button
              variant="outline"
              onClick={() => {
                handleClose();
                setIsBugScreenshotOpen(true);
              }}
              disabled={isLoading}
              className="w-full py-6 bg-(--background-lightest)"
            >
              <BugIcon className="mr-2 h-5 w-5" />{" "}
              {isLoading ? "Preparing Report..." : "Report a Bug"}
            </Button>
            <p className="text-sm text-muted-foreground px-2">
              We'll auto-fill your report with system info and logs. You can
              review it for any sensitive info before submitting.
            </p>
          </div>
        </div>
      </DialogContent>
      <HelpBotDialog
        isOpen={isHelpBotOpen}
        onClose={() => setIsHelpBotOpen(false)}
      />
      <BugScreenshotDialog
        isOpen={isBugScreenshotOpen}
        onClose={() => setIsBugScreenshotOpen(false)}
        handleReportBug={handleReportBug}
        isLoading={isLoading}
      />
    </Dialog>
  );
}
