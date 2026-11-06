import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";

interface FetchModelsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  providerId: string;
  /** apiNames already saved for this provider; shown as "Already added". */
  existingApiNames: string[];
}

export function FetchModelsDialog({
  isOpen,
  onClose,
  onSuccess,
  providerId,
  existingApiNames,
}: FetchModelsDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);

  const {
    data: fetched,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.languageModels.fetchCustomProviderModels({
      providerId,
    }),
    queryFn: () => ipc.languageModel.fetchCustomProviderModels({ providerId }),
    enabled: isOpen,
    networkMode: "always",
    staleTime: 0,
    gcTime: 0, // always ask the server again when the dialog reopens
    retry: false,
  });

  useEffect(() => {
    if (isOpen) setSelected(new Set());
  }, [isOpen]);

  const existing = new Set(existingApiNames);
  // Ignore stale results while a refetch is running or after it failed.
  const list = isFetching || error ? [] : (fetched ?? []);
  const addable = list.filter((m) => !existing.has(m.apiName));
  const chosen = addable.filter((m) => selected.has(m.apiName));

  const toggle = (apiName: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(apiName)) next.add(apiName);
      return next;
    });

  const handleAdd = async () => {
    setIsAdding(true);
    try {
      // The main process re-checks for duplicates against the database, so
      // this stays correct even if another window imported in the meantime.
      const { added, skipped } =
        await ipc.languageModel.importCustomProviderModels({
          providerId,
          models: chosen,
        });
      if (added > 0) {
        showSuccess(`Added ${added} model${added === 1 ? "" : "s"}`);
      }
      if (skipped > 0) {
        showSuccess(
          `${skipped} model${skipped === 1 ? " was" : "s were"} already added`,
        );
      }
      onSuccess();
      onClose();
    } catch (error) {
      showError(error);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => !open && !isAdding && onClose()}
    >
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Fetch Models</DialogTitle>
          <DialogDescription>
            Models served by this provider's endpoint. Select the ones to add.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-80 overflow-y-auto space-y-2 py-2">
          {isFetching && <Skeleton className="h-16 w-full" />}
          {!isFetching && error && (
            <div className="text-sm text-red-600 dark:text-red-400">
              {error.message}
              <Button
                variant="outline"
                size="sm"
                className="ml-2"
                onClick={() => refetch()}
              >
                Retry
              </Button>
            </div>
          )}
          {!isFetching && !error && fetched?.length === 0 && (
            <p className="text-sm text-muted-foreground">
              The server reported no models.
            </p>
          )}
          {!isFetching &&
            !error &&
            fetched?.map((m) => {
              const already = existing.has(m.apiName);
              return (
                <label
                  key={m.apiName}
                  className={`flex items-center gap-3 rounded-md border p-3 ${
                    already ? "opacity-50" : "cursor-pointer"
                  }`}
                >
                  <Checkbox
                    checked={already || selected.has(m.apiName)}
                    disabled={already}
                    onCheckedChange={() => toggle(m.apiName)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="truncate font-medium">{m.apiName}</div>
                    {m.contextWindow && (
                      <div className="text-xs text-muted-foreground">
                        Context: {m.contextWindow.toLocaleString()} tokens
                      </div>
                    )}
                  </div>
                  {already && (
                    <span className="text-xs text-muted-foreground">
                      Already added
                    </span>
                  )}
                </label>
              );
            })}
        </div>

        <DialogFooter>
          {addable.length > 0 && (
            <Button
              variant="ghost"
              onClick={() =>
                setSelected(
                  chosen.length === addable.length
                    ? new Set()
                    : new Set(addable.map((m) => m.apiName)),
                )
              }
              disabled={isAdding}
            >
              {chosen.length === addable.length ? "Clear" : "Select all"}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={isAdding}>
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={isAdding || chosen.length === 0}
          >
            {isAdding
              ? "Adding..."
              : `Add ${chosen.length} model${chosen.length === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
