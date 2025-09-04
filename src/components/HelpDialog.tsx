import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  BookOpenIcon,
  BugIcon,
  UploadIcon,
  ChevronLeftIcon,
  CheckIcon,
  XIcon,
  FileIcon,
  SparklesIcon,
} from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { useState, useEffect } from "react";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { ChatLogsData } from "@/ipc/ipc_types";
import { showError } from "@/lib/toast";
import { HelpBotDialog } from "./HelpBotDialog";
import { useSettings } from "@/hooks/useSettings";

interface HelpDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpDialog({ isOpen, onClose }: HelpDialogProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [reviewMode, setReviewMode] = useState(false);
  const [chatLogsData, setChatLogsData] = useState<ChatLogsData | null>(null);
  const [uploadComplete, setUploadComplete] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [isHelpBotOpen, setIsHelpBotOpen] = useState(false);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const { settings } = useSettings();

  const isDyadProUser = settings?.providerSettings?.["auto"]?.apiKey?.value;

  // Function to reset all dialog state
  const resetDialogState = () => {
    setIsLoading(false);
    setIsUploading(false);
    setReviewMode(false);
    setChatLogsData(null);
    setUploadComplete(false);
    setSessionId("");
  };

  // Reset state when dialog closes or reopens
  useEffect(() => {
    if (!isOpen) {
      resetDialogState();
    }
  }, [isOpen]);

  // Wrap the original onClose to also reset state
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
<!-- 
⚠️ IMPORTANT: All sections marked as required must be completed in English.
Issues that do not meet these requirements will be closed and may need to be resubmitted.
-->

## Bug Description (required)
<!-- Please describe the issue you're experiencing -->

## Steps to Reproduce (required)
<!-- Please list the steps to reproduce the issue -->

## Expected Behavior (required)
<!-- What did you expect to happen? -->

## Actual Behavior (required)
<!-- What actually happened? -->

## System Information
- Dyad Version: ${debugInfo.dyadVersion}
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
      const githubIssueUrl = `https://github.com/dyad-sh/dyad/issues/new?title=${encodedTitle}&labels=bug,filed-from-app&body=${encodedBody}`;

      // Open the pre-filled GitHub issue page
      IpcClient.getInstance().openExternalUrl(githubIssueUrl);
    } catch (error) {
      console.error("Failed to prepare bug report:", error);
      // Fallback to opening the regular GitHub issue page
      IpcClient.getInstance().openExternalUrl(
        "https://github.com/dyad-sh/dyad/issues/new",
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleUploadChatSession = async () => {
    if (!selectedChatId) {
      alert("Please select a chat first");
      return;
    }

    setIsUploading(true);
    try {
      // Get chat logs (includes debug info, chat data, and codebase)
      const chatLogs =
        await IpcClient.getInstance().getChatLogs(selectedChatId);

      // Store data for review and switch to review mode
      setChatLogsData(chatLogs);
      setReviewMode(true);
    } catch (error) {
      console.error("Failed to upload chat session:", error);
      alert(
        "Failed to upload chat session. Please try again or report manually.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmitChatLogs = async () => {
    if (!chatLogsData) return;

    setIsUploading(true);
    try {
      // Prepare data for upload
      const chatLogsJson = {
        systemInfo: chatLogsData.debugInfo,
        chat: chatLogsData.chat,
        codebaseSnippet: chatLogsData.codebase,
      };

      // Get signed URL
      const response = await fetch(
        "https://upload-logs.dyad.sh/generate-upload-url",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            extension: "json",
            contentType: "application/json",
          }),
        },
      );

      if (!response.ok) {
        showError(`Failed to get upload URL: ${response.statusText}`);
        throw new Error(`Failed to get upload URL: ${response.statusText}`);
      }

      const { uploadUrl, filename } = await response.json();

      await IpcClient.getInstance().uploadToSignedUrl(
        uploadUrl,
        "application/json",
        chatLogsJson,
      );

      // Extract session ID (filename without extension)
      const sessionId = filename.replace(".json", "");
      setSessionId(sessionId);
      setUploadComplete(true);
      setReviewMode(false);
    } catch (error) {
      console.error("Failed to upload chat logs:", error);
      alert("Failed to upload chat logs. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancelReview = () => {
    setReviewMode(false);
    setChatLogsData(null);
  };

  const handleOpenGitHubIssue = () => {
    // Create a GitHub issue with the session ID
    const issueBody = `
<!-- 
⚠️ IMPORTANT: All sections marked as required must be completed in English.
Issues that do not meet these requirements will be closed and may need to be resubmitted.
-->

Session ID: ${sessionId}

## Issue Description (required)
<!-- Please describe the issue you're experiencing -->

## Expected Behavior (required)
<!-- What did you expect to happen? -->

## Actual Behavior (required)
<!-- What actually happened? -->
`;

    const encodedBody = encodeURIComponent(issueBody);
    const encodedTitle = encodeURIComponent("[session report] <add title>");
    const githubIssueUrl = `https://github.com/dyad-sh/dyad/issues/new?title=${encodedTitle}&labels=support&body=${encodedBody}`;

    IpcClient.getInstance().openExternalUrl(githubIssueUrl);
    handleClose();
  };

  if (uploadComplete) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Complete</DialogTitle>
          </DialogHeader>
          <div className="py-6 flex flex-col items-center space-y-4">
            <div className="bg-green-50 dark:bg-green-900/20 p-6 rounded-full">
              <CheckIcon className="h-8 w-8 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="text-lg font-medium">
              Chat Logs Uploaded Successfully
            </h3>
            <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded flex items-center space-x-2 font-mono text-sm">
              <FileIcon
                className="h-4 w-4 cursor-pointer"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(sessionId);
                  } catch (err) {
                    console.error("Failed to copy session ID:", err);
                  }
                }}
              />
              <span>{sessionId}</span>
            </div>
            <p className="text-center text-sm">
              You must open a GitHub issue for us to investigate. Without a
              linked issue, your report will not be reviewed.
            </p>
          </div>
          <DialogFooter>
            <Button onClick={handleOpenGitHubIssue} className="w-full">
              Open GitHub Issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (reviewMode && chatLogsData) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              <Button
                variant="ghost"
                className="mr-2 p-0 h-8 w-8"
                onClick={handleCancelReview}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              OK to upload chat session?
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>
            Please review the information that will be submitted. Your chat
            messages, system information, and a snapshot of your codebase will
            be included.
          </DialogDescription>

          <div className="space-y-4 overflow-y-auto flex-grow">
            <div className="border rounded-md p-3">
              <h3 className="font-medium mb-2">Chat Messages</h3>
              <div className="text-sm bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-40 overflow-y-auto">
                {chatLogsData.chat.messages.map((msg) => (
                  <div key={msg.id} className="mb-2">
                    <span className="font-semibold">
                      {msg.role === "user" ? "You" : "Assistant"}:{" "}
                    </span>
                    <span>{msg.content}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border rounded-md p-3">
              <h3 className="font-medium mb-2">Codebase Snapshot</h3>
              <div className="text-sm bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-40 overflow-y-auto font-mono">
                {chatLogsData.codebase}
              </div>
            </div>

            <div className="border rounded-md p-3">
              <h3 className="font-medium mb-2">Logs</h3>
              <div className="text-sm bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-40 overflow-y-auto font-mono">
                {chatLogsData.debugInfo.logs}
              </div>
            </div>

            <div className="border rounded-md p-3">
              <h3 className="font-medium mb-2">System Information</h3>
              <div className="text-sm bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-32 overflow-y-auto">
                <p>Dyad Version: {chatLogsData.debugInfo.dyadVersion}</p>
                <p>Platform: {chatLogsData.debugInfo.platform}</p>
                <p>Architecture: {chatLogsData.debugInfo.architecture}</p>
                <p>
                  Node Version:{" "}
                  {chatLogsData.debugInfo.nodeVersion || "Not available"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex justify-between mt-4 pt-2 sticky bottom-0 bg-background">
            <Button
              variant="outline"
              onClick={handleCancelReview}
              className="flex items-center"
            >
              <XIcon className="mr-2 h-4 w-4" /> Cancel
            </Button>
            <Button
              onClick={handleSubmitChatLogs}
              className="flex items-center"
              disabled={isUploading}
            >
              {isUploading ? (
                "Uploading..."
              ) : (
                <>
                  <CheckIcon className="mr-2 h-4 w-4" /> Upload
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Need help with Dyad?</DialogTitle>
        </DialogHeader>
        <DialogDescription className="">
          If you need help or want to report an issue, here are some options:
        </DialogDescription>
        <div className="flex flex-col space-y-4 w-full">
          {isDyadProUser ? (
            <div className="flex flex-col space-y-2">
              <Button
                variant="default"
                onClick={() => {
                  setIsHelpBotOpen(true);
                }}
                className="w-full py-6 border-primary/50 shadow-sm shadow-primary/10 transition-all hover:shadow-md hover:shadow-primary/15"
              >
                <SparklesIcon className="mr-2 h-5 w-5" /> Chat with Dyad help
                bot (Pro)
              </Button>
              <p className="text-sm text-muted-foreground px-2">
                Opens an in-app help chat assistant that searches through Dyad's
                docs.
              </p>
            </div>
          ) : (
            <div className="flex flex-col space-y-2">
              <Button
                variant="outline"
                onClick={() => {
                  IpcClient.getInstance().openExternalUrl(
                    "https://www.dyad.sh/docs",
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
          )}

          <div className="flex flex-col space-y-2">
            <Button
              variant="outline"
              onClick={handleReportBug}
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
          <div className="flex flex-col space-y-2">
            <Button
              variant="outline"
              onClick={handleUploadChatSession}
              disabled={isUploading || !selectedChatId}
              className="w-full py-6 bg-(--background-lightest)"
            >
              <UploadIcon className="mr-2 h-5 w-5" />{" "}
              {isUploading ? "Preparing Upload..." : "Upload Chat Session"}
            </Button>
            <p className="text-sm text-muted-foreground px-2">
              Share chat logs and code for troubleshooting. Data is used only to
              resolve your issue and auto-deleted after a limited time.
            </p>
          </div>
        </div>
      </DialogContent>
      <HelpBotDialog
        isOpen={isHelpBotOpen}
        onClose={() => setIsHelpBotOpen(false)}
      />
    </Dialog>
  );
}
