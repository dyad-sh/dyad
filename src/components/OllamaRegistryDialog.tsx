import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { DownloadIcon, Loader2Icon, SearchIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipc, type OllamaPullProgress } from "@/ipc/types";
import { showError, showSuccess } from "@/lib/toast";

interface ActivePull {
  pullId: string;
  model: string;
  progress: OllamaPullProgress | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function describeProgress(progress: OllamaPullProgress | null): string {
  if (!progress) return "Starting…";
  const { status, completed, total } = progress;
  if (total && completed !== undefined) {
    const percent = Math.floor((completed / total) * 100);
    return `${percent}% · ${formatBytes(completed)} / ${formatBytes(total)}`;
  }
  return status;
}

export function OllamaRegistryDialog({
  open,
  onOpenChange,
  installedModelNames,
  onModelPulled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  installedModelNames: string[];
  onModelPulled: () => void;
}) {
  const [term, setTerm] = useState("");
  const [variantFilter, setVariantFilter] = useState("");
  const [activePull, setActivePull] = useState<ActivePull | null>(null);
  const activePullId = useRef<string | null>(null);

  // Progress and the Cancel button live here; once this unmounts nothing can
  // show or stop the download, so stop it rather than let it run unseen.
  useEffect(() => {
    return () => {
      if (activePullId.current) {
        void ipc.languageModel.cancelOllamaPull({
          pullId: activePullId.current,
        });
      }
    };
  }, []);

  const search = useMutation({
    mutationFn: (searchTerm: string) =>
      ipc.languageModel.searchOllamaRegistry({ term: searchTerm }),
  });

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = term.trim();
    if (trimmed) search.mutate(trimmed);
  };

  const handlePull = async (model: string) => {
    const pullId = crypto.randomUUID();
    activePullId.current = pullId;
    setActivePull({ pullId, model, progress: null });
    // Subscribed for this pull only, before invoking so no early progress is
    // missed. Progress events and the invoke reply are not ordered relative
    // to each other, so unsubscribing once the reply settles drops any late
    // progress for a pull that has already finished.
    const unsubscribe = ipc.events.languageModel.onOllamaPullProgress(
      (progress) => {
        if (progress.pullId !== pullId) return;
        setActivePull((current) =>
          current?.pullId === pullId ? { ...current, progress } : current,
        );
      },
    );
    try {
      await ipc.languageModel.pullOllamaModel({ pullId, model });
      showSuccess(`${model} is ready to use`);
      onModelPulled();
    } catch (error) {
      if (!(error instanceof Error && /cancelled/i.test(error.message))) {
        showError(error);
      }
    } finally {
      unsubscribe();
      if (activePullId.current === pullId) activePullId.current = null;
      setActivePull((current) => (current?.pullId === pullId ? null : current));
    }
  };

  const handleCancel = () => {
    if (activePull) {
      void ipc.languageModel.cancelOllamaPull({ pullId: activePull.pullId });
    }
  };

  const installed = new Set(installedModelNames);
  const results = search.data?.models ?? [];
  // The registry only matches family names, so variant suffixes such as
  // `-mlx` or `q4_K_M` are narrowed here, over the full `family:tag` name.
  const variantNeedle = variantFilter.trim().toLowerCase();
  const visibleResults = variantNeedle
    ? results.filter((model) =>
        model.name.toLowerCase().includes(variantNeedle),
      )
    : results;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-2xl"
        data-testid="ollama-registry-dialog"
      >
        <DialogHeader>
          <DialogTitle>Browse the Ollama registry</DialogTitle>
          <DialogDescription>
            Search official and community models, then download them to your
            Ollama server. Community models include their author, e.g.{" "}
            <code>mannix/phi3-mini-4k</code>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSearch} className="flex gap-2">
          <Input
            autoFocus
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search models, e.g. qwen3-coder"
            aria-label="Search the Ollama registry"
          />
          <Button
            type="submit"
            disabled={!term.trim() || search.isPending}
            className="cursor-pointer"
          >
            {search.isPending ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <SearchIcon className="size-4" />
            )}
            Search
          </Button>
        </form>

        {activePull && (
          <div
            className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
            role="status"
          >
            <Loader2Icon className="size-4 shrink-0 animate-spin" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-medium">{activePull.model}</span>
              <span className="text-xs text-muted-foreground">
                {describeProgress(activePull.progress)}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        )}

        {search.error ? (
          <p role="alert" className="text-sm text-red-600">
            {search.error.message}
          </p>
        ) : search.isSuccess && results.length === 0 ? (
          <p className="text-sm text-muted-foreground">No models found.</p>
        ) : results.length > 0 ? (
          <>
            <div className="flex items-center gap-2">
              <Input
                value={variantFilter}
                onChange={(event) => setVariantFilter(event.target.value)}
                placeholder="Filter variants, e.g. mlx or q4_K_M"
                aria-label="Filter results by variant"
                className="h-8"
              />
              <span className="shrink-0 text-xs text-muted-foreground">
                {visibleResults.length} / {results.length}
              </span>
            </div>
            {visibleResults.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No variant matches this filter.
              </p>
            ) : (
              <div className="max-h-[50vh] overflow-y-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Model</th>
                      <th className="px-3 py-2 font-medium">Updated</th>
                      <th className="px-3 py-2 font-medium">Context</th>
                      <th className="px-3 py-2 font-medium">Size</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {visibleResults.map((model) => (
                      <tr key={model.name} className="border-t">
                        <td className="px-3 py-1.5 font-mono text-xs break-all">
                          {model.name}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {model.updated ?? "—"}
                        </td>
                        <td className="px-3 py-1.5">{model.context ?? "—"}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {model.size ?? "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {installed.has(model.name) ? (
                            <span className="text-xs text-muted-foreground">
                              Installed
                            </span>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="cursor-pointer"
                              disabled={activePull !== null}
                              onClick={() => void handlePull(model.name)}
                              aria-label={`Download ${model.name}`}
                            >
                              <DownloadIcon className="size-3.5" />
                              Download
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
