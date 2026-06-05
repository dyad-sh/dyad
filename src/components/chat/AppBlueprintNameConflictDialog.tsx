import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useCheckName } from "@/hooks/useCheckName";
import { useDebounce } from "@/hooks/useDebounce";

interface AppBlueprintNameConflictDialogProps {
  /** The rejected app name that is already in use, pre-filled into the input. */
  rejectedName: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the new, conflict-free name when the user confirms. */
  onSubmit: (newName: string) => void;
}

export function AppBlueprintNameConflictDialog({
  rejectedName,
  isOpen,
  onOpenChange,
  onSubmit,
}: AppBlueprintNameConflictDialogProps) {
  const [name, setName] = useState(rejectedName);

  // Re-seed the input whenever the dialog opens for a (potentially new)
  // rejected name so the user always starts from the name that was refused.
  useEffect(() => {
    if (isOpen) {
      setName(rejectedName);
    }
  }, [isOpen, rejectedName]);

  const trimmedName = name.trim();
  // Debounce before hitting the name-check IPC so we don't fire a request on
  // every keystroke. Skip the query for the rejected name since we already
  // know it's taken.
  const debouncedName = useDebounce(trimmedName, 300);
  const { data: nameCheckResult, isLoading: isCheckingName } = useCheckName(
    debouncedName !== rejectedName ? debouncedName : "",
  );
  const nameExists =
    trimmedName !== rejectedName &&
    debouncedName === trimmedName &&
    !!nameCheckResult?.exists;
  // Disable submit until the user picks a different, non-empty name that
  // isn't already taken. The initial value equals the rejected name, so the
  // button stays disabled until they actually change it. We also wait for the
  // debounce to settle and the name-check to finish so a conflicting name
  // can't slip through while the query is still in flight.
  const canSubmit =
    trimmedName.length > 0 &&
    trimmedName !== rejectedName &&
    !nameExists &&
    debouncedName === trimmedName &&
    !isCheckingName;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(trimmedName);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle size={18} className="text-amber-500" />
            App name already in use
          </DialogTitle>
          <DialogDescription>
            An app named &ldquo;{rejectedName}&rdquo; already exists. Please
            choose a different name to continue approving this blueprint.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 py-4">
          <Label htmlFor="blueprint-conflict-name">App name</Label>
          <Input
            id="blueprint-conflict-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter a new app name"
            className={nameExists ? "border-red-500" : ""}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSubmit();
            }}
            autoFocus
          />
          {nameExists && (
            <p className="text-sm text-red-500">
              That name is also already in use. Try another one.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            Use name &amp; approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
