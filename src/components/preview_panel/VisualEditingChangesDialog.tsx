import { useAtom, useAtomValue } from "jotai";
import { useSetAtom } from "jotai";
import {
  clearPendingVisualChangesForAppAtom,
  pendingVisualChangesAtom,
} from "@/atoms/previewAtoms";
import { Button } from "@/components/ui/button";
import { ipc } from "@/ipc/types";
import type { ApplyVisualEditingChangesParams } from "@/ipc/types";
import { Check, X } from "lucide-react";
import { useRef, useState } from "react";
import { showError, showSuccess } from "@/lib/toast";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useMutation } from "@tanstack/react-query";

interface VisualEditingChangesDialogProps {
  onReset?: () => void;
}

export function VisualEditingChangesDialog({
  onReset,
}: VisualEditingChangesDialogProps) {
  const [pendingChanges, setPendingChanges] = useAtom(pendingVisualChangesAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const clearPendingChangesForApp = useSetAtom(
    clearPendingVisualChangesForAppAtom,
  );
  const [isSaving, setIsSaving] = useState(false);
  const selectedAppIdRef = useRef(selectedAppId);
  selectedAppIdRef.current = selectedAppId;
  const applyChangesMutation = useMutation({
    mutationFn: (params: ApplyVisualEditingChangesParams) =>
      ipc.visualEditing.applyChanges(params),
  });

  if (pendingChanges.size === 0) return null;

  const handleSave = async () => {
    if (selectedAppId === null) return;
    const appId = selectedAppId;
    const changesToSave = Array.from(pendingChanges.values());
    setIsSaving(true);
    try {
      await applyChangesMutation.mutateAsync({ appId, changes: changesToSave });
      clearPendingChangesForApp(appId);
      showSuccess("Visual changes saved to source files");
      if (selectedAppIdRef.current === appId) {
        onReset?.();
      }
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
