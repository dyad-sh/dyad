import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";
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
import type { FileAttachment, ChatAttachment } from "@/ipc/types/chat";
import { selectedChatIdAtom, chatMessagesByIdAtom } from "@/atoms/chatAtoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useProposal } from "@/hooks/useProposal";
import { useSettings } from "@/hooks/useSettings";

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
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const [aiChatId, setAiChatId] = useState<number | null>(selectedChatId);
  const [aiMessageId, setAiMessageId] = useState<number | null>(null);
  const [aiResolution, setAiResolution] = useState<string | null>(null);
  const [autoApproveStatus, setAutoApproveStatus] = useState<
    "idle" | "pending" | "applied" | "timed_out"
  >("idle");
  const setMessagesById = useSetAtom(chatMessagesByIdAtom);
  const { refreshProposal } = useProposal(aiChatId || undefined);
  const { settings } = useSettings();
  const currentFile = conflicts[currentConflictIndex];
  const isAutoApproveEnabled = settings?.autoApproveChanges ?? false;
  const isMountedRef = useRef(true);
  const currentFileRef = useRef(currentFile);

  const ensureChatId = async () => {
    if (aiChatId) return aiChatId;
    const newChatId = await ipc.chat.createChat(appId);
    setAiChatId(newChatId);
    return newChatId;
  };

  const getNextConflictIndex = useCallback(
    (remainingConflicts: string[]) => {
      if (remainingConflicts.length === 0) return null;
      const remainingSet = new Set(remainingConflicts);
      for (let i = currentConflictIndex + 1; i < conflicts.length; i += 1) {
        if (remainingSet.has(conflicts[i])) return i;
      }
      for (let i = 0; i < currentConflictIndex; i += 1) {
        if (remainingSet.has(conflicts[i])) return i;
      }
      return null;
    },
    [conflicts, currentConflictIndex],
  );

  const countConflicts = (content: string): number => {
    const matches = content.match(/<<<<<<<[^\n]*\n/g);
    return matches ? matches.length : 0;
  };

  const refreshChatMessages = async (chatId: number) => {
    try {
      const chat = await ipc.chat.getChat(chatId);
      setMessagesById((prev) => {
        const next = new Map(prev);
        next.set(chatId, chat.messages);
        return next;
      });
    } catch (err) {
      console.error("Failed to refresh chat messages", err);
    }
  };

  const loadFileContent = useCallback(async () => {
    if (!currentFile) return;
    const fileForThisRequest = currentFile;
    try {
      const content = await ipc.app.readAppFile({
        appId,
        filePath: currentFile,
      });
      if (
        !isMountedRef.current ||
        fileForThisRequest !== currentFileRef.current
      ) {
        return;
      }
      setFileContent(content);
      setAiResolution(null);
      setAiMessageId(null);
    } catch (error: any) {
      showError(`Failed to load file ${currentFile}: ${error.message}`);
    }
  }, [appId, currentFile]);

  useEffect(() => {
    isMountedRef.current = true;
    currentFileRef.current = currentFile;

    loadFileContent();
    setIsAiResolving(false);
    setIsManualResolving(false);
    setIsResolving(false);
    setAutoApproveStatus("idle");

    return () => {
      isMountedRef.current = false;
    };
  }, [currentFile, appId, loadFileContent]);

  const extractConflictParts = (content: string) => {
    const conflicts: Array<{ current: string; incoming: string }> = [];
    const conflictRegex =
      /^<<<<<<< .*\r?\n([\s\S]*?)^=======\r?\n([\s\S]*?)^>>>>>>> .*(\r?\n|$)/gm;

    let match;
    while ((match = conflictRegex.exec(content)) !== null) {
      conflicts.push({
        current: match[1].trim(),
        incoming: match[2].trim(),
      });
    }

    return conflicts;
  };

  const handleAiResolve = async () => {
    setIsAiResolving(true);
    setAutoApproveStatus(isAutoApproveEnabled ? "pending" : "idle");
    try {
      const chatId = await ensureChatId();
      const fileForThisRequest = currentFile;

      const fileAttachment: FileAttachment = {
        file: new File([fileContent], currentFile, { type: "text/plain" }),
        type: "chat-context",
      };

      // Convert FileAttachment to ChatAttachment (base64 encoded)
      const chatAttachment: ChatAttachment = await new Promise(
        (resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            resolve({
              name: fileAttachment.file.name,
              type: fileAttachment.file.type,
              data: reader.result as string,
              attachmentType: fileAttachment.type,
            });
          };
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(fileAttachment.file);
        },
      );

      const conflictCount = countConflicts(fileContent);
      const conflictNote =
        conflictCount > 1
          ? `\n\nIMPORTANT: This file contains ${conflictCount} conflict(s). You must resolve ALL of them. Return the complete resolved file content with all conflict markers removed.`
          : "\n\nReturn the fully resolved file content with all conflict markers removed.";

      ipc.chatStream.start(
        {
          chatId,
          prompt: `Resolve the Git conflict(s) in ${currentFile}.${conflictNote}

The full file content is attached. Review the entire file and resolve all conflict markers (<<<<<<<, =======, >>>>>>>).`,
          attachments: [chatAttachment],
        },
        {
          onChunk: ({ messages }) => {
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
          onEnd: async () => {
            if (
              !isMountedRef.current ||
              fileForThisRequest !== currentFileRef.current
            ) {
              return;
            }

            // Refresh messages and proposal to check if auto-approval applied changes
            await refreshChatMessages(chatId);
            await refreshProposal();

            // If auto-approval is enabled, wait a bit for it to process, then check if file was updated
            if (isAutoApproveEnabled) {
              // Poll for changes (auto-approval happens in the stream handler but is async)
              const pollForChanges = async () => {
                const maxAttempts = 20; // 5 seconds total
                const interval = 250;

                for (let i = 0; i < maxAttempts; i++) {
                  if (
                    !isMountedRef.current ||
                    fileForThisRequest !== currentFileRef.current
                  ) {
                    return;
                  }

                  try {
                    const updatedContent = await ipc.app.readAppFile({
                      appId,
                      filePath: currentFile,
                    });

                    // Check if conflicts are resolved in the file
                    const updatedConflicts =
                      extractConflictParts(updatedContent);
                    if (updatedConflicts.length === 0) {
                      // Success!
                      setFileContent(updatedContent);
                      setAiResolution(null);
                      setAiMessageId(null);
                      setAutoApproveStatus("applied");
                      showSuccess("AI resolution automatically applied");

                      const allRemainingConflicts =
                        await ipc.github.getConflicts({ appId });
                      if (allRemainingConflicts.length === 0) {
                        onResolve();
                      } else {
                        const nextIndex = getNextConflictIndex(
                          allRemainingConflicts,
                        );
                        if (nextIndex === null) {
                          onResolve();
                        } else {
                          setCurrentConflictIndex(nextIndex);
                        }
                      }
                      setIsAiResolving(false);
                      return;
                    }
                  } catch {
                    // Ignore read errors during polling
                  }

                  // Wait before next poll
                  await new Promise((resolve) => setTimeout(resolve, interval));
                }

                // Timeout reached
                if (isMountedRef.current) {
                  showSuccess("AI suggested a resolution");
                  setAutoApproveStatus("timed_out");
                  setIsAiResolving(false);
                }
              };

              await pollForChanges();
            } else {
              showSuccess("AI suggested a resolution");
              setAutoApproveStatus("idle");
              setIsAiResolving(false);
            }
          },
          onError: ({ error }) => {
            if (
              !isMountedRef.current ||
              fileForThisRequest !== currentFileRef.current
            ) {
              return;
            }
            showError(error || "Failed to resolve with AI");
            setAutoApproveStatus("idle");
            setIsAiResolving(false);
          },
        },
      );
    } catch (error: any) {
      showError(error.message || "Failed to resolve with AI");
      setAutoApproveStatus("idle");
      setIsAiResolving(false);
    }
  };

  const handleManualResolve = async () => {
    setIsManualResolving(true);
    try {
      // resolveConflict handler now writes and stages the file automatically
      await ipc.github.resolveConflict({
        appId,
        file: currentFile,
      });

      // Reload file content to get the updated version
      await loadFileContent();

      setAiResolution(null);
      setAiMessageId(null);
      showSuccess("Applied manual conflict resolution");

      // Verify all conflicts are resolved before moving forward
      const remainingConflicts = await ipc.github.getConflicts({ appId });
      if (remainingConflicts.length === 0) {
        // All conflicts resolved, complete the merge
        onResolve();
      } else {
        const nextIndex = getNextConflictIndex(remainingConflicts);
        if (nextIndex === null) {
          showError(
            `Resolved current file, but ${remainingConflicts.length} file(s) still have conflicts.`,
          );
          onResolve();
        } else {
          setCurrentConflictIndex(nextIndex);
        }
      }
    } catch (error: any) {
      showError(error.message || "Failed to resolve conflict manually");
    }
    setIsManualResolving(false);
  };

  const handleApplyAiResolution = async () => {
    if (!aiChatId || !aiMessageId) {
      showError("No AI suggestion to approve yet.");
      return;
    }
    setIsResolving(true);
    try {
      await ipc.proposal.approveProposal({
        chatId: aiChatId,
        messageId: aiMessageId,
      });
      await loadFileContent();
      await refreshChatMessages(aiChatId);
      setAiResolution(null);
      setAiMessageId(null);
      setAutoApproveStatus("idle");
      refreshProposal();
      showSuccess("Applied AI suggestion via approval.");

      // Verify all conflicts are resolved before moving forward
      const remainingConflicts = await ipc.github.getConflicts({ appId });
      if (remainingConflicts.length === 0) {
        // All conflicts resolved, complete the merge
        onResolve();
      } else {
        const nextIndex = getNextConflictIndex(remainingConflicts);
        if (nextIndex === null) {
          showError(
            `Resolved current file, but ${remainingConflicts.length} file(s) still have conflicts.`,
          );
          onResolve();
        } else {
          setCurrentConflictIndex(nextIndex);
        }
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
                {isManualResolving ? "Resolving..." : "Accept Current Changes"}
              </Button>
            </div>
            {(() => {
              const conflicts = extractConflictParts(fileContent);
              const conflictCount = conflicts.length;

              if (conflictCount === 0) {
                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-3 bg-white dark:bg-gray-900 rounded-md border">
                      <div className="font-semibold text-sm mb-2">
                        Current (ours)
                      </div>
                      <pre className="text-xs whitespace-pre-wrap font-mono text-gray-800 dark:text-gray-100 max-h-40 sm:max-h-48 overflow-auto">
                        No current section detected.
                      </pre>
                    </div>
                    <div className="p-3 bg-white dark:bg-gray-900 rounded-md border">
                      <div className="font-semibold text-sm mb-2">
                        Incoming (theirs)
                      </div>
                      <pre className="text-xs whitespace-pre-wrap font-mono text-gray-800 dark:text-gray-100 max-h-40 sm:max-h-48 overflow-auto">
                        No incoming section detected.
                      </pre>
                    </div>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  {conflictCount > 1 && (
                    <div className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                      This file contains {conflictCount} conflict
                      {conflictCount > 1 ? "s" : ""}. All conflicts are shown
                      below.
                    </div>
                  )}
                  <div className="space-y-3 max-h-96 overflow-y-auto">
                    {conflicts.map((conflict, index) => (
                      <div
                        key={index}
                        className="grid grid-cols-1 md:grid-cols-2 gap-3"
                      >
                        <div className="p-3 bg-white dark:bg-gray-900 rounded-md border">
                          <div className="font-semibold text-sm mb-2">
                            Current (ours)
                            {conflictCount > 1 && (
                              <span className="ml-2 text-xs font-normal text-gray-500">
                                Conflict {index + 1}/{conflictCount}
                              </span>
                            )}
                          </div>
                          <pre className="text-xs whitespace-pre-wrap font-mono text-gray-800 dark:text-gray-100 max-h-40 sm:max-h-48 overflow-auto">
                            {conflict.current || "No current section detected."}
                          </pre>
                        </div>
                        <div className="p-3 bg-white dark:bg-gray-900 rounded-md border">
                          <div className="font-semibold text-sm mb-2">
                            Incoming (theirs)
                            {conflictCount > 1 && (
                              <span className="ml-2 text-xs font-normal text-gray-500">
                                Conflict {index + 1}/{conflictCount}
                              </span>
                            )}
                          </div>
                          <pre className="text-xs whitespace-pre-wrap font-mono text-gray-800 dark:text-gray-100 max-h-40 sm:max-h-48 overflow-auto">
                            {conflict.incoming ||
                              "No incoming section detected."}
                          </pre>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>

          {aiResolution && (
            <div className="border rounded-md p-3 bg-white dark:bg-gray-900">
              <div className="flex flex-wrap justify-between items-center mb-2 gap-2">
                <div className="font-semibold">AI Suggested Resolution</div>
                {(!isAutoApproveEnabled ||
                  autoApproveStatus === "idle" ||
                  autoApproveStatus === "timed_out") && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleApplyAiResolution}
                    disabled={isResolving || isAiResolving}
                  >
                    Approve
                  </Button>
                )}
                {isAutoApproveEnabled && autoApproveStatus === "pending" && (
                  <span className="text-xs text-gray-500">
                    Auto-approving...
                  </span>
                )}
                {isAutoApproveEnabled && autoApproveStatus === "applied" && (
                  <span className="text-xs text-gray-500">
                    Auto-approved - changes applied automatically
                  </span>
                )}
                {isAutoApproveEnabled && autoApproveStatus === "timed_out" && (
                  <span className="text-xs text-gray-500">
                    Auto-approval timed out. Review and approve manually.
                  </span>
                )}
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
          )}
        </div>

        <DialogFooter className="mt-4 pt-3 border-t flex flex-wrap gap-2 justify-between">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
