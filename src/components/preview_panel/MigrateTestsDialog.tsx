import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { LegacyTestFile } from "@/hooks/useLegacyTestMigration";

interface MigrateTestsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  files: LegacyTestFile[];
  onConfirm: (selected: string[]) => Promise<void>;
  isSubmitting: boolean;
}

export function MigrateTestsDialog({
  open,
  onOpenChange,
  files,
  onConfirm,
  isSubmitting,
}: MigrateTestsDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // A file can be moved only when its destination doesn't already exist;
  // conflicting ones are shown disabled so the user can't try to overwrite.
  const selectableFiles = useMemo(
    () => files.filter((f) => !f.targetExists),
    [files],
  );

  // Seed the default selection only on the closed→open transition. A background
  // refetch that changes `files` while the dialog is open must not reset the
  // user's choices (e.g. re-checking files they deliberately deselected).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open && !wasOpen.current) {
      // Default to moving everything that can be moved.
      setSelected(new Set(selectableFiles.map((f) => f.file)));
    }
    wasOpen.current = open;
  }, [open, selectableFiles]);

  const toggle = (file: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(file)) next.delete(file);
      else next.add(file);
      return next;
    });
  };

  const allSelected =
    selectableFiles.length > 0 && selected.size === selectableFiles.length;

  const toggleAll = () => {
    setSelected(
      allSelected ? new Set() : new Set(selectableFiles.map((f) => f.file)),
    );
  };

  const handleConfirm = async () => {
    if (selected.size === 0) return;
    await onConfirm(Array.from(selected));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-md p-4">
        <DialogHeader className="pb-2">
          <DialogTitle>Move end-to-end tests to e2e-tests/</DialogTitle>
          <DialogDescription className="text-xs">
            Dyad now keeps Playwright end-to-end tests in{" "}
            <code>e2e-tests/</code>. Move the selected tests out of{" "}
            <code>tests/</code> so they stay visible and runnable in this panel.
            Fixtures and helpers they import move along with them.
          </DialogDescription>
        </DialogHeader>

        {selectableFiles.length > 0 && (
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">
              {selected.size} of {selectableFiles.length} selected
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleAll}
              disabled={isSubmitting}
            >
              {allSelected ? "Clear all" : "Select all"}
            </Button>
          </div>
        )}

        <div
          className="max-h-72 overflow-y-auto rounded-md border border-border bg-(--background-lighter) p-1"
          data-testid="migrate-tests-dialog-list"
        >
          {files.map((f) => {
            const checked = selected.has(f.file);
            return (
              <label
                key={f.file}
                className={cn(
                  "flex items-center gap-2 rounded-sm px-2 py-1.5",
                  f.targetExists
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer hover:bg-muted",
                )}
                data-testid={`migrate-tests-dialog-item-${f.file}`}
              >
                <Checkbox
                  checked={checked}
                  disabled={f.targetExists || isSubmitting}
                  onCheckedChange={() => toggle(f.file)}
                />
                <span className="flex-1 truncate font-mono text-sm">
                  {f.file}
                </span>
                {f.targetExists && (
                  <span className="shrink-0 text-[10px] italic text-muted-foreground">
                    already in e2e-tests/
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <DialogFooter className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
            size="sm"
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={isSubmitting || selected.size === 0}
            size="sm"
            className="flex items-center gap-1"
            data-testid="migrate-tests-dialog-confirm"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Moving...
              </>
            ) : (
              `Move ${selected.size} test${selected.size === 1 ? "" : "s"}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
