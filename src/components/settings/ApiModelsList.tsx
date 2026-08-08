import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, PlusIcon, RefreshCw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ipc } from "@/ipc/types";
import type { ApiModel } from "@/ipc/types/language-model";
import { queryKeys } from "@/lib/queryKeys";
import { showError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";

/**
 * The live model list straight from the provider's own `/models` endpoint.
 *
 * The built-in catalogue is curated and lags behind what an account can
 * actually use — preview, realtime and newly released models in particular —
 * so this shows the real set and lets any of them be added.
 */
export function ApiModelsList({
  providerId,
  existingApiNames,
}: {
  providerId: string;
  existingApiNames: string[];
}) {
  const queryClient = useQueryClient();
  const [models, setModels] = useState<ApiModel[] | null>(null);
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState<string | null>(null);

  const loadMutation = useMutation({
    mutationFn: () => ipc.languageModel.listApiModels({ providerId }),
    onSuccess: (result) => {
      setModels(result.models);
      setBaseUrl(result.baseUrl);
      if (result.models.length === 0) {
        showError("The provider returned no models.");
      }
    },
    onError: (error: unknown) =>
      showError(
        error instanceof Error ? error.message : "Could not load models.",
      ),
  });

  const addMutation = useMutation({
    mutationFn: (model: ApiModel) =>
      ipc.languageModel.createCustomModel({
        apiName: model.id,
        displayName: model.id,
        providerId,
        description: model.ownedBy ? `Provided by ${model.ownedBy}` : undefined,
      }),
    onSuccess: (_result, model) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.languageModels.forProvider({ providerId }),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.languageModels.byProviders,
      });
      showSuccess(`Added ${model.id}`);
    },
    onError: (error: unknown) =>
      showError(
        error instanceof Error ? error.message : "Could not add that model.",
      ),
    onSettled: () => setAdding(null),
  });

  const known = new Set(existingApiNames);
  const visible = (models ?? []).filter((model) =>
    filter.trim()
      ? model.id.toLowerCase().includes(filter.trim().toLowerCase())
      : true,
  );

  return (
    <div className="mt-8 rounded-lg border border-border/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            Available from the API
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {baseUrl
              ? `${models?.length ?? 0} models reported by ${baseUrl}`
              : "Ask this provider which models your API key can use."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadMutation.mutate()}
          disabled={loadMutation.isPending}
          data-testid="load-api-models"
        >
          {loadMutation.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          {models ? "Refresh" : "Load models"}
        </Button>
      </div>

      {models && models.length > 0 && (
        <>
          <div className="relative mt-4">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter models…"
              className="pl-9"
              aria-label="Filter available models"
            />
          </div>

          <ul className="mt-3 max-h-80 space-y-1 overflow-y-auto pr-1">
            {visible.map((model) => {
              const alreadyAdded = known.has(model.id);
              return (
                <li
                  key={model.id}
                  className="flex items-center gap-3 rounded-md border border-transparent px-2 py-1.5 hover:border-border/60 hover:bg-muted/40"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs text-foreground">
                      {model.id}
                    </span>
                    {model.ownedBy && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {model.ownedBy}
                      </span>
                    )}
                  </span>
                  {alreadyAdded ? (
                    <span
                      className={cn(
                        "flex shrink-0 items-center gap-1 text-[11px]",
                        "text-emerald-600 dark:text-emerald-400",
                      )}
                    >
                      <Check className="h-3.5 w-3.5" />
                      Added
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      disabled={adding === model.id}
                      onClick={() => {
                        setAdding(model.id);
                        addMutation.mutate(model);
                      }}
                      data-testid={`add-api-model-${model.id}`}
                    >
                      {adding === model.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <PlusIcon className="h-3.5 w-3.5" />
                      )}
                      Add
                    </Button>
                  )}
                </li>
              );
            })}
            {visible.length === 0 && (
              <li className="px-2 py-3 text-sm text-muted-foreground">
                No models match “{filter}”.
              </li>
            )}
          </ul>
        </>
      )}
    </div>
  );
}
