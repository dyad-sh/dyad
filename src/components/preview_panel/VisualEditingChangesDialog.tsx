import { useAtom } from "jotai";
import { pendingVisualChangesAtom } from "@/atoms/previewAtoms";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { Check, X } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { showError, showSuccess } from "@/lib/toast";

interface VisualEditingChangesDialogProps {
  onReset?: () => void;
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
}

export function VisualEditingChangesDialog({
  onReset,
  iframeRef,
}: VisualEditingChangesDialogProps) {
  const [pendingChanges, setPendingChanges] = useAtom(pendingVisualChangesAtom);
  const [isSaving, setIsSaving] = useState(false);
  const textContentCache = useRef<Map<string, string>>(new Map());

  // Listen for text content responses
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "dyad-text-content-response") {
        const { componentId, text } = event.data;
        if (text !== null) {
          textContentCache.current.set(componentId, text);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  if (pendingChanges.size === 0) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Request text content for all components that might be editing
      const changesToSave = Array.from(pendingChanges.values());

      if (iframeRef?.current?.contentWindow) {
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

        // Wait a bit for responses
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Update changes with cached text content
        const updatedChanges = changesToSave.map((change) => {
          const cachedText = textContentCache.current.get(change.componentId);
          if (cachedText !== undefined) {
            return { ...change, textContent: cachedText };
          }
          return change;
        });

        await IpcClient.getInstance().applyVisualEditingChanges(updatedChanges);
      } else {
        await IpcClient.getInstance().applyVisualEditingChanges(changesToSave);
      }

      setPendingChanges(new Map());
      textContentCache.current.clear();
      showSuccess("Visual changes saved to source files");
      onReset?.();
    } catch (error) {
      console.error("Failed to save visual editing changes:", error);
      showError(`Failed to save changes: ${error}`);
    } finally {
      setIsSaving(false);
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
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isSaving}
          className="bg-[#7f22fe] hover:bg-[#450e91ff] dark:text-white text-xs lg:text-sm px-2 lg:px-3 flex-1 lg:flex-initial"
        >
          <Check size={14} className="mr-1" />
          <span>{isSaving ? "Saving..." : "Save Changes"}</span>
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDiscard}
          disabled={isSaving}
          className="text-xs lg:text-sm px-2 lg:px-3 flex-1 lg:flex-initial"
        >
          <X size={14} className="mr-1" />
          <span>Discard</span>
        </Button>
      </div>
    </div>
  );
}
