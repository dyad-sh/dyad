import { useAtom } from "jotai";
import { pendingVisualChangesAtom } from "@/atoms/previewAtoms";
import { Button } from "@/components/ui/button";
import { IpcClient } from "@/ipc/ipc_client";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { showError, showSuccess } from "@/lib/toast";

interface VisualEditingChangesDialogProps {
  onReset?: () => void;
}

export function VisualEditingChangesDialog({
  onReset,
}: VisualEditingChangesDialogProps) {
  const [pendingChanges, setPendingChanges] = useAtom(pendingVisualChangesAtom);
  const [isSaving, setIsSaving] = useState(false);

  if (pendingChanges.size === 0) return null;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await IpcClient.getInstance().applyVisualEditingChanges(
        Array.from(pendingChanges.values()),
      );
      setPendingChanges(new Map());
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
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-[var(--background)] border border-[var(--border)] rounded-lg shadow-lg p-4 z-50 flex items-center gap-4">
      <p className="text-sm">
        <span className="font-medium">{pendingChanges.size}</span> component
        {pendingChanges.size > 1 ? "s" : ""} modified
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isSaving}
          className="bg-[#7f22fe] hover:bg-[#450e91ff]"
        >
          <Check size={16} className="mr-1" />
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={handleDiscard}
          disabled={isSaving}
        >
          <X size={16} className="mr-1" />
          Discard
        </Button>
      </div>
    </div>
  );
}
