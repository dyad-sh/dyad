import { useAtom, useAtomValue } from "jotai";
import { pendingVisualChangesAtom } from "@/atoms/previewAtoms";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { Check, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { showError, showSuccess } from "@/lib/toast";
import { selectedAppIdAtom } from "@/atoms/appAtoms";

interface VisualEditingChangesDialogProps {
  onReset?: () => void;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
}

export function VisualEditingChangesDialog({
  onReset,
  iframeRef,
}: VisualEditingChangesDialogProps) {
  const [pendingChanges, setPendingChanges] = useAtom(pendingVisualChangesAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [isSaving, setIsSaving] = useState(false);
  const textContentCache = useRef<Map<string, string>>(new Map());
  const [allResponsesReceived, setAllResponsesReceived] = useState(false);
  const expectedResponsesRef = useRef<Set<string>>(new Set());
  const isWaitingForResponses = useRef(false);

  // Listen for text content responses
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "dyad-text-content-response") {
        const { componentId, text } = event.data;
        if (text !== null) {
          textContentCache.current.set(componentId, text);
        }

        // Mark this response as received
        expectedResponsesRef.current.delete(componentId);

        // Check if all responses received (only if we're actually waiting)
        if (
          isWaitingForResponses.current &&
          expectedResponsesRef.current.size === 0
        ) {
          setAllResponsesReceived(true);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Execute when all responses are received
  useEffect(() => {
    if (allResponsesReceived && isSaving) {
      const applyChanges = async () => {
        try {
          const changesToSave = Array.from(pendingChanges.values());

          // Update changes with cached text content
          const updatedChanges = changesToSave.map((change) => {
            const cachedText = textContentCache.current.get(change.componentId);
            if (cachedText !== undefined) {
              return { ...change, textContent: cachedText };
            }
            return change;
          });

          await IpcClient.getInstance().applyVisualEditingChanges({
            appId: selectedAppId!,
            changes: updatedChanges,
          });

          setPendingChanges(new Map());
          textContentCache.current.clear();
          showSuccess("Visual changes saved to source files");
          onReset?.();
        } catch (error) {
          console.error("Failed to save visual editing changes:", error);
          showError(`Failed to save changes: ${error}`);
        } finally {
          setIsSaving(false);
          setAllResponsesReceived(false);
          isWaitingForResponses.current = false;
        }
      };

      applyChanges();
    }
  }, [
    allResponsesReceived,
    isSaving,
    pendingChanges,
    selectedAppId,
    onReset,
    setPendingChanges,
  ]);

  if (pendingChanges.size === 0) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const changesToSave = Array.from(pendingChanges.values());

      if (iframeRef?.current?.contentWindow) {
        // Reset state for new request
        setAllResponsesReceived(false);
        expectedResponsesRef.current.clear();
        isWaitingForResponses.current = true;

        // Track which components we're expecting responses from
        for (const change of changesToSave) {
          expectedResponsesRef.current.add(change.componentId);
        }

        // Request text content for each component
        for (const change of changesToSave) {
          iframeRef.current.contentWindow.postMessage(
            {
              type: "get-dyad-text-content",
              data: { componentId: change.componentId },
            },
            "*",
          );
        }

        // If no responses are expected, trigger immediately
        if (expectedResponsesRef.current.size === 0) {
          setAllResponsesReceived(true);
        }
      } else {
        await IpcClient.getInstance().applyVisualEditingChanges({
          appId: selectedAppId!,
          changes: changesToSave,
        });

        setPendingChanges(new Map());
        textContentCache.current.clear();
        showSuccess("Visual changes saved to source files");
        onReset?.();
      }
    } catch (error) {
      console.error("Failed to save visual editing changes:", error);
      showError(`Failed to save changes: ${error}`);
      setIsSaving(false);
      isWaitingForResponses.current = false;
    }
  };

  const handleDiscard = () => {
    setPendingChanges(new Map());
    onReset?.();
  };

  return (
    <div className="bg-[var(--background)] border-b border-[var(--border)] px-2 lg:px-4 py-1.5 flex flex-col lg:flex-row items-start lg:items-center lg:justify-between gap-1.5 lg:gap-4 flex-wrap">
      <p className="text-xs lg:text-sm w-full lg:w-auto">
        <span className="font-medium">{pendingChanges.size}</span> component
        {pendingChanges.size > 1 ? "s" : ""} modified
      </p>
      <div className="flex gap-1 lg:gap-2 w-full lg:w-auto flex-wrap">
        <Button size="sm" onClick={handleSave} disabled={isSaving}>
          <Check size={14} className="mr-1" />
          <span>{isSaving ? "Saving..." : "Save Changes"}</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDiscard}
          disabled={isSaving}
        >
          <X size={14} className="mr-1" />
          <span>Discard</span>
        </Button>
      </div>
    </div>
  );
}
