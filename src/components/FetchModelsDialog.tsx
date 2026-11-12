import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";

const MAX_LIST_HEIGHT = 320;
// Row plus its gap; only the first-render estimate before rows are measured.
const ROW_HEIGHT = 72;

interface FetchModelsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  providerId: string;
  /** apiNames already saved for this provider; shown as "Already added". */
  existingApiNames: string[];
}

export function FetchModelsDialog({
  isOpen,
  onClose,
  providerId,
  existingApiNames,
}: FetchModelsDialogProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [listHeight, setListHeight] = useState<number | null>(null);

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
    // The list is replaced by skeletons while fetching, so a background
    // refetch would wipe the user's view just from switching windows.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  useEffect(() => {
    if (isOpen) {
      setSelected(new Set());
      setSearch("");
    }
  }, [isOpen]);

  const existing = new Set(existingApiNames);
  // Ignore stale results while a refetch is running or after it failed.
  const list = isFetching || error ? [] : (fetched ?? []);
  const needle = search.trim().toLowerCase();
  const visible = list.filter((m) => m.apiName.toLowerCase().includes(needle));
  // Selection survives filtering, so "Add N" also counts models the filter hides.
  const addable = list.filter((m) => !existing.has(m.apiName));
  const chosen = addable.filter((m) => selected.has(m.apiName));
  const visibleAddable = visible.filter((m) => !existing.has(m.apiName));
  const allVisibleChosen =
    visibleAddable.length > 0 &&
    visibleAddable.every((m) => selected.has(m.apiName));

  const toggle = (apiName: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(apiName)) next.add(apiName);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const m of visibleAddable) {
        if (allVisibleChosen) next.delete(m.apiName);
        else next.add(m.apiName);
      }
      return next;
    });

  const handleAdd = async () => {
    setIsAdding(true);
    try {
      // The main process re-checks for duplicates against the database, so
      // this stays correct even if another window imported in the meantime.
      // The contract's `invalidates` refreshes the model lists in every window.
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
          <DialogTitle>Import Models</DialogTitle>
          <DialogDescription>
            Models served by this provider's endpoint. Select the ones to add.
          </DialogDescription>
        </DialogHeader>

        <div
          data-testid="model-import-region"
          className="flex h-[368px] flex-col gap-2"
        >
          {(isFetching || list.length > 0) && (
            <div className="relative h-10 shrink-0">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                aria-label="Search models"
                className="h-10 pl-9"
              />
            </div>
          )}

          <div
            data-testid="model-list-region"
            className="h-80 shrink-0 overflow-y-auto space-y-2"
          >
            {isFetching &&
              Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
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
            {list.length > 0 && visible.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No models match "{search.trim()}".
              </p>
            )}

            {visible.length > 0 && (
              <Virtuoso
                style={{
                  height: Math.min(
                    listHeight ?? visible.length * ROW_HEIGHT,
                    MAX_LIST_HEIGHT,
                  ),
                }}
                data={visible}
                defaultItemHeight={ROW_HEIGHT}
                totalListHeightChanged={setListHeight}
                computeItemKey={(_, m) => m.apiName}
                itemContent={(_, m) => {
                  const already = existing.has(m.apiName);
                  return (
                    <div className="pb-2">
                      <label
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
                          <div className="truncate font-medium">
                            {m.apiName}
                          </div>
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
                    </div>
                  );
                }}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          {visibleAddable.length > 0 && (
            <Button
              variant="ghost"
              onClick={toggleAllVisible}
              disabled={isAdding}
            >
              {allVisibleChosen ? "Clear" : "Select all"}
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
