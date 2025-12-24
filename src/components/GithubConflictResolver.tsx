import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { AlertTriangle, Wand2, Hand } from "lucide-react";
import { showError, showSuccess } from "@/lib/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DyadMarkdownParser } from "@/components/chat/DyadMarkdownParser";
import { FileEditor } from "@/components/preview_panel/FileEditor";
import type { FileAttachment } from "@/ipc/ipc_types";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import { useAtom, useSetAtom } from "jotai";
import { useProposal } from "@/hooks/useProposal";

interface ConflictResolverProps {
  appId: number;
  conflicts: string[];
  onResolve: () => void;
  onCancel: () => void;
}

export function GithubConflictResolver({
  appId,
  conflicts,
  onResolve,
  onCancel,
}: ConflictResolverProps) {
  const [currentConflictIndex, setCurrentConflictIndex] = useState(0);
  const [fileContent, setFileContent] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [isAiResolving, setIsAiResolving] = useState(false);
  const [isManualResolving, setIsManualResolving] = useState(false);
  const [aiChatId, setAiChatId] = useAtom(selectedChatIdAtom);
  const [aiMessageId, setAiMessageId] = useState<number | null>(null);
  const [aiResolution, setAiResolution] = useState<string | null>(null);
  const [resolvedContentOverride, setResolvedContentOverride] = useState<
    string | null
  >(null);
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const { refreshProposal } = useProposal(aiChatId || undefined);
  const [latestContent, setLatestContent] = useState<string | null>(null);
  const currentFile = conflicts[currentConflictIndex];
  const isMountedRef = useRef(true);
  const currentFileRef = useRef(currentFile);

  useEffect(() => {
    isMountedRef.current = true;
    currentFileRef.current = currentFile;

    // run per file/app change
    loadFileContent();
    setResolvedContentOverride(null);
    // Reset resolving states when switching files to prevent them from getting stuck
    setIsAiResolving(false);
    setIsManualResolving(false);
    setIsResolving(false);

    // cleanup runs on every dependency change (currentFile/appId) and on unmount
    // Note: isMountedRef only guards against component unmount, not file switches.
    // File switching is protected by comparing fileForThisRequest against currentFileRef.current
    // in handleAiResolve callbacks.
    return () => {
      isMountedRef.current = false;
    };
  }, [currentFile, appId]);

  const ensureChatId = async () => {
    if (aiChatId) return aiChatId;
    const newChatId = await IpcClient.getInstance().createChat(appId);
    setAiChatId(newChatId);
    return newChatId;
  };
  // Extracts a snippet around the conflict markers for AI context
  const extractConflictSnippet = (content: string) => {
    const start = content.indexOf("<<<<<<<");
    if (start === -1) return content.slice(0, 1000);
    const end = content.indexOf(">>>>>>>", start);
    const sliceEnd = end === -1 ? start + 1200 : end + 7;
    return content.slice(start, sliceEnd).slice(0, 1500);
  };

  // Refresh chat messages for a given chat ID
  const refreshChatMessages = async (chatId: number) => {
    try {
      const chat = await IpcClient.getInstance().getChat(chatId);
      setMessagesById((prev) => {
        const next = new Map(prev);
        next.set(chatId, chat.messages);
        return next;
      });
    } catch (err) {
      // best-effort; do not block flow
      console.error("Failed to refresh chat messages", err);
    }
  };

  const loadFileContent = async () => {
    if (!currentFile) return;
    try {
      const content = await IpcClient.getInstance().readAppFile(
        appId,
        currentFile,
      );
      setFileContent(content);
      setLatestContent(content);
      setAiResolution(null);
      setAiMessageId(null);
      setResolvedContentOverride(null);
    } catch (error: any) {
      showError(`Failed to load file ${currentFile}: ${error.message}`);
    }
  };

  // Extracts the current and incoming parts of a Git conflict
  const extractConflictParts = (content: string) => {
    const start = content.indexOf("<<<<<<<");
    const sep = content.indexOf("=======", start + 7);
    const end = content.indexOf(">>>>>>>", sep + 7);
    if (start === -1 || sep === -1 || end === -1) {
      return { current: "", incoming: "" };
    }
    const current = content.slice(start + 7, sep).trim();
    const incoming = content.slice(sep + 7, end).trim();
    return { current, incoming };
  };

  // Handles AI-based conflict resolution
  const handleAiResolve = async () => {
    setIsAiResolving(true);
    try {
      const chatId = await ensureChatId();

      // Capture the current file in a closure to prevent stale callbacks
      // from updating state when the user switches files
      const fileForThisRequest = currentFile;

      const attachment: FileAttachment = {
        file: new File([fileContent], currentFile, { type: "text/plain" }),
        type: "chat-context",
      };

      IpcClient.getInstance().streamMessage(
        `Resolve the Git conflict in ${currentFile}.
The conflict markers are shown below. Return the fully resolved file content only.

${extractConflictSnippet(fileContent)}`,
        {
          chatId,
          attachments: [attachment],
          onUpdate: (messages) => {
            // Check both mount status and that we're still on the same file
            // Use currentFileRef.current to get the current value, not the closure value
            if (
              !isMountedRef.current ||
              fileForThisRequest !== currentFileRef.current
            ) {
              return;
            }
            const lastAssistant = [...messages]
              .reverse()
              .find((msg) => msg.role === "assistant");
            if (lastAssistant?.content) {
              setAiResolution(lastAssistant.content);
              if (lastAssistant.id) {
                setAiMessageId(lastAssistant.id);
              }
            }
          },
          onEnd: () => {
            // Check both mount status and that we're still on the same file
            // Use currentFileRef.current to get the current value, not the closure value
            if (
              !isMountedRef.current ||
              fileForThisRequest !== currentFileRef.current
            ) {
              // Reset state even if we're switching files to prevent it from getting stuck
              setIsAiResolving(false);
              return;
            }
            showSuccess("AI suggested a resolution");
            refreshChatMessages(chatId);
            setIsAiResolving(false);
          },
          onError: (error) => {
            // Check both mount status and that we're still on the same file
            // Use currentFileRef.current to get the current value, not the closure value
            if (
              !isMountedRef.current ||
              fileForThisRequest !== currentFileRef.current
            ) {
              // Reset state even if we're switching files to prevent it from getting stuck
              setIsAiResolving(false);
              return;
            }
            showError(error || "Failed to resolve with AI");
            setIsAiResolving(false);
          },
        },
      );
    } catch (error: any) {
      showError(error.message || "Failed to resolve with AI");
      setIsAiResolving(false);
    }
  };

  // Handles manual Git conflict resolution
  const handleManualResolve = async () => {
    setIsManualResolving(true);
    try {
      const result = await IpcClient.getInstance().resolveGithubConflict(
        appId,
        currentFile,
      );

      if (!result.success || !result.resolution) {
        throw new Error(result.error || "Failed to resolve conflict");
      }

      await IpcClient.getInstance().editAppFile(
        appId,
        currentFile,
        result.resolution,
      );

      setAiResolution(null);
      setAiMessageId(null);
      setFileContent(result.resolution);
      setResolvedContentOverride(result.resolution);
      setLatestContent(result.resolution);
      showSuccess("Applied manual conflict resolution");

      // Move to next conflict or finish if this was the last one
      if (currentConflictIndex < conflicts.length - 1) {
        setCurrentConflictIndex(currentConflictIndex + 1);
      } else {
        onResolve();
      }
    } catch (error: any) {
      showError(error.message || "Failed to resolve conflict manually");
    }
    setIsManualResolving(false);
  };

  // Handles saving the resolved content
  const handleSaveResolution = async () => {
    setIsResolving(true);
    try {
      const latest =
        latestContent ??
        (await IpcClient.getInstance().readAppFile(appId, currentFile));
      setLatestContent(latest);

      showSuccess(`Resolved ${currentFile}`);

      if (currentConflictIndex < conflicts.length - 1) {
        setCurrentConflictIndex(currentConflictIndex + 1);
      } else {
        onResolve();
      }
    } catch (error: any) {
      showError(error.message || "Failed to save resolution");
    } finally {
      setIsResolving(false);
    }
  };

  // Applies the AI-suggested resolution to the file
  const handleApplyAiResolution = async () => {
    if (!aiChatId || !aiMessageId) {
      showError("No AI suggestion to approve yet.");
      return;
    }
    setIsResolving(true);
    try {
      await IpcClient.getInstance().approveProposal({
        chatId: aiChatId,
        messageId: aiMessageId,
      });
      await loadFileContent();
      await refreshChatMessages(aiChatId);
      setAiResolution(null);
      setAiMessageId(null);
      refreshProposal();
      showSuccess("Applied AI suggestion via approval.");

      // Move to next conflict or finish if this was the last one
      if (currentConflictIndex < conflicts.length - 1) {
        setCurrentConflictIndex(currentConflictIndex + 1);
      } else {
        onResolve();
      }
    } catch (error: any) {
      showError(error?.message || "Failed to approve AI suggestion");
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className="
                    max-w-5xl 
                    w-[95vw] sm:w-full 
                    max-h-[85vh] 
                    flex flex-col 
                    p-4 sm:p-6
                "
      >
        <DialogHeader className="pb-3 border-b">
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-500" />
            Resolve Conflicts ({currentConflictIndex + 1}/{conflicts.length})
          </DialogTitle>
          <DialogDescription>
            Resolving conflict in:{" "}
            <span className="font-mono font-bold break-all">{currentFile}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable content area */}
        <div className="flex-1 min-h-0 mt-3 space-y-3 overflow-y-auto pr-1">
          <div className="bg-gray-100 dark:bg-gray-800 p-3 flex flex-col gap-2 border rounded-md">
            <div className="flex flex-wrap justify-between items-center gap-2">
              <span className="text-sm text-gray-600 dark:text-gray-300">
                Review the conflicting sections, then resolve via AI or manual
                edit.
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAiResolve}
                disabled={isAiResolving}
                className="gap-2"
              >
                <Wand2 className="h-3 w-3" />
                {isAiResolving ? "AI Resolving..." : "Auto-Resolve with AI"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleManualResolve}
                disabled={isManualResolving}
                className="gap-2"
              >
                <Hand className="h-3 w-3" />
                {isManualResolving
                  ? "Manual Resolving..."
                  : "Manual Git Resolve"}
              </Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 bg-white dark:bg-gray-900 rounded-md border">
                <div className="font-semibold text-sm mb-2">Current (ours)</div>
                <pre
                  className="
                                        text-xs whitespace-pre-wrap font-mono 
                                        text-gray-800 dark:text-gray-100 
                                        max-h-40 sm:max-h-48 overflow-auto
                                    "
                >
                  {extractConflictParts(fileContent).current ||
                    "No current section detected."}
                </pre>
              </div>
              <div className="p-3 bg-white dark:bg-gray-900 rounded-md border">
                <div className="font-semibold text-sm mb-2">
                  Incoming (theirs)
                </div>
                <pre
                  className="
                                        text-xs whitespace-pre-wrap font-mono 
                                        text-gray-800 dark:text-gray-100 
                                        max-h-40 sm:max-h-48 overflow-auto
                                    "
                >
                  {extractConflictParts(fileContent).incoming ||
                    "No incoming section detected."}
                </pre>
              </div>
            </div>
          </div>

          {aiResolution ? (
            <div className="border rounded-md p-3 bg-white dark:bg-gray-900">
              <div className="flex flex-wrap justify-between items-center mb-2 gap-2">
                <div className="font-semibold">AI Suggested Resolution</div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleApplyAiResolution}
                  disabled={isResolving || isAiResolving}
                >
                  Apply to file
                </Button>
              </div>
              <div
                className="
                                    prose dark:prose-invert  
                                    border rounded-md p-3 
                                    bg-gray-50 dark:bg-gray-800
                                "
              >
                <DyadMarkdownParser content={aiResolution} />
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 border rounded-md overflow-hidden flex flex-col">
              <div className="bg-gray-100 dark:bg-gray-800 p-2 flex justify-between items-center border-b">
                <span className="text-xs text-gray-500">
                  Manual edit (File Editor). Save changes before finishing.
                </span>
              </div>
              <div className="h-96 min-h-96 border border-gray-200 dark:border-gray-700 rounded overflow-hidden">
                <FileEditor appId={appId} filePath={currentFile} />
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4 pt-3 border-t flex flex-wrap gap-2 justify-between">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          {!aiResolution && !resolvedContentOverride && (
            <Button
              onClick={handleSaveResolution}
              disabled={isResolving || isAiResolving}
              data-testid="finish-resolution-button"
            >
              {currentConflictIndex < conflicts.length - 1
                ? "Next Conflict"
                : "Finish Resolution"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
