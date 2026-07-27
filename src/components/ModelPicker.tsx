import type { LargeLanguageModel } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePostHog } from "posthog-js/react";
import { useLocalModels } from "@/hooks/useLocalModels";
import { useLocalLMSModels } from "@/hooks/useLMStudioModels";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";

import { type LanguageModel, LocalModel } from "@/ipc/types";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useSettings } from "@/hooks/useSettings";
import { PriceBadge } from "@/components/PriceBadge";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CheckIcon, LockIcon } from "lucide-react";
import { ProviderIcon } from "@/components/ProviderIcon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";

const SCROLL_AREA_CLASS = "max-h-100 overflow-y-auto scrollbar-on-hover";

const PILL_CLASS =
  "text-[10px] leading-none px-1.5 py-1 rounded-full font-medium";

type Tier = { label: string; caption: string; min: number; max: number };
const PRICE_TIERS: Tier[] = [
  {
    label: "Premium",
    caption: "Strongest and most expensive",
    min: 6,
    max: Number.POSITIVE_INFINITY,
  },
  {
    label: "Standard",
    caption: "Balanced quality and cost",
    min: 3,
    max: 5,
  },
  {
    label: "Value",
    caption: "Most cost-efficient",
    min: Number.NEGATIVE_INFINITY,
    max: 2,
  },
];

function tierFor(dollarSigns: number | undefined): Tier {
  const ds = dollarSigns ?? Number.NEGATIVE_INFINITY;
  return (
    PRICE_TIERS.find((t) => ds >= t.min && ds <= t.max) ??
    PRICE_TIERS[PRICE_TIERS.length - 1]
  );
}

export function ModelPicker() {
  const { settings, updateSettings, loading: settingsLoading } = useSettings();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const posthog = usePostHog();
  const onModelSelect = (model: LargeLanguageModel) => {
    posthog.capture("model-picker:select", {
      provider: model.provider,
      model: model.name,
    });
    void updateSettings({ selectedModel: model });
    // Invalidate token count when model changes since different models have different context windows
    // (technically they have different tokenizers, but we don't keep track of that).
    queryClient.invalidateQueries({ queryKey: queryKeys.tokenCount.all });
  };

  const [open, setOpen] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<{
    providerId: string;
    model: LanguageModel;
  } | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      posthog.capture("model-picker:open");
    }
  };

  // Cloud models from providers
  const { data: modelsByProviders, isLoading: modelsByProvidersLoading } =
    useLanguageModelsByProviders();

  const {
    data: providers,
    isLoading: providersLoading,
    isProviderSetup,
  } = useLanguageModelProviders();

  const loading = modelsByProvidersLoading || providersLoading;
  // Ollama Models Hook
  const {
    models: ollamaModels,
    loading: ollamaLoading,
    error: ollamaError,
    loadModels: loadOllamaModels,
  } = useLocalModels();

  // LM Studio Models Hook
  const {
    models: lmStudioModels,
    loading: lmStudioLoading,
    error: lmStudioError,
    loadModels: loadLMStudioModels,
  } = useLocalLMSModels();

  // Load models when the dropdown opens
  useEffect(() => {
    if (open) {
      loadOllamaModels();
      loadLMStudioModels();
    }
  }, [open, loadOllamaModels, loadLMStudioModels]);

  // Get display name for the selected model
  const getModelDisplayName = () => {
    if (selectedModel.provider === "ollama") {
      return (
        ollamaModels.find(
          (model: LocalModel) => model.modelName === selectedModel.name,
        )?.displayName || selectedModel.name
      );
    }
    if (selectedModel.provider === "lmstudio") {
      return (
        lmStudioModels.find(
          (model: LocalModel) => model.modelName === selectedModel.name,
        )?.displayName || selectedModel.name // Fallback to path if not found
      );
    }

    // For cloud models, look up in the modelsByProviders data
    if (modelsByProviders && modelsByProviders[selectedModel.provider]) {
      const customFoundModel = modelsByProviders[selectedModel.provider].find(
        (model) =>
          model.type === "custom" && model.id === selectedModel.customModelId,
      );
      if (customFoundModel) {
        return customFoundModel.displayName;
      }
      const foundModel = modelsByProviders[selectedModel.provider].find(
        (model) => model.apiName === selectedModel.name,
      );
      if (foundModel) {
        return foundModel.displayName;
      }
    }

    // Fallback if not found
    return selectedModel.name;
  };

  // Determine availability of local models
  const hasOllamaModels =
    !ollamaLoading && !ollamaError && ollamaModels.length > 0;
  const hasLMStudioModels =
    !lmStudioLoading && !lmStudioError && lmStudioModels.length > 0;

  if (!settings) {
    return null;
  }
  const selectedModel = settings?.selectedModel;
  const modelDisplayName = getModelDisplayName();
  // Split providers into primary and secondary groups.
  const providerEntries =
    !loading && modelsByProviders ? Object.entries(modelsByProviders) : [];
  const primaryProviderEntries = providerEntries.filter(
    ([providerId, models]) => {
      if (models.length === 0) return false;
      const provider = providers?.find((p) => p.id === providerId);
      return !(provider && provider.secondary);
    },
  );
  const primaryProviders: [string, LanguageModel[]][] = primaryProviderEntries;
  const secondaryProviders = providerEntries.filter(([providerId, models]) => {
    if (models.length === 0) return false;
    const provider = providers?.find((p) => p.id === providerId);
    return !!(provider && provider.secondary);
  });
  const groupedProviders: [string, LanguageModel[]][] = [
    ...primaryProviders,
    ...secondaryProviders,
  ];
  const flatModelEntries = primaryProviderEntries
    .flatMap(([providerId, models], providerIndex) =>
      models.flatMap((model, modelIndex) => {
        return [{ providerId, model, providerIndex, modelIndex }];
      }),
    )
    .sort((a, b) => {
      const aPrice = a.model.dollarSigns ?? Number.NEGATIVE_INFINITY;
      const bPrice = b.model.dollarSigns ?? Number.NEGATIVE_INFINITY;
      if (aPrice !== bPrice) {
        return bPrice - aPrice;
      }
      if (a.providerIndex !== b.providerIndex) {
        return a.providerIndex - b.providerIndex;
      }
      return a.modelIndex - b.modelIndex;
    });

  const getProviderDisplayName = (providerId: string) => {
    const provider = providers?.find((p) => p.id === providerId);
    return provider?.name ?? providerId;
  };

  // Custom and local providers do not require a catalog provider key.
  // While settings/env vars are still loading we can't tell whether a key
  // exists, so fail open rather than flash a lock at env-var-configured users.
  const isModelLocked = (providerId: string) => {
    if (settingsLoading) {
      return false;
    }
    const provider = providers?.find((p) => p.id === providerId);
    return provider?.type === "cloud" && !isProviderSetup(providerId);
  };

  const handleLockedModelClick = (providerId: string, model: LanguageModel) => {
    posthog.capture("model-picker:locked-model-click", {
      provider: providerId,
      model: model.apiName,
    });
    setOpen(false);
    setUnlockTarget({ providerId, model });
  };

  const handleUnlockDialogOwnKeyClick = () => {
    if (!unlockTarget) {
      return;
    }
    posthog.capture("model-picker:add-own-key-click", {
      provider: unlockTarget.providerId,
    });
    const providerId = unlockTarget.providerId;
    setUnlockTarget(null);
    navigate({
      to: providerSettingsRoute.id,
      params: { provider: providerId },
    });
  };

  const unlockTargetProviderName = unlockTarget
    ? getProviderDisplayName(unlockTarget.providerId)
    : "";

  const handleCloudModelSelect = (providerId: string, model: LanguageModel) => {
    if (isModelLocked(providerId)) {
      handleLockedModelClick(providerId, model);
      return;
    }
    const customModelId = model.type === "custom" ? model.id : undefined;
    void onModelSelect({
      name: model.apiName,
      provider: providerId,
      customModelId,
    });
    setOpen(false);
  };

  const renderCloudModelItem = ({
    providerId,
    model,
    showProvider = false,
    showPrice = true,
  }: {
    providerId: string;
    model: LanguageModel;
    showProvider?: boolean;
    showPrice?: boolean;
  }) => {
    const isSelected =
      selectedModel.provider === providerId &&
      selectedModel.name === model.apiName;
    const isLocked = isModelLocked(providerId);
    const item = (
      <DropdownMenuItem
        key={`${providerId}-${model.apiName}`}
        data-locked={isLocked || undefined}
        aria-label={
          isLocked
            ? `${model.displayName} requires an API key from ${getProviderDisplayName(providerId)}`
            : undefined
        }
        className={cn(
          "relative px-2 py-1.5",
          isSelected &&
            "bg-primary/8 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary",
        )}
        onClick={() => {
          handleCloudModelSelect(providerId, model);
        }}
      >
        <div className="flex justify-between items-center gap-2 w-full">
          <span className="min-w-0 flex items-center gap-2">
            <ProviderIcon providerId={providerId} apiName={model.apiName} />
            <span className="min-w-0 flex flex-col items-start">
              <span
                className={cn(
                  "text-[13px] truncate leading-tight",
                  isLocked && "text-muted-foreground",
                )}
              >
                {model.displayName}
              </span>
              {showProvider && (
                <span className="text-xs text-muted-foreground truncate">
                  {getProviderDisplayName(providerId)}
                </span>
              )}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {showPrice && <PriceBadge dollarSigns={model.dollarSigns} />}
            {model.tag && (
              <span
                className={cn(
                  PILL_CLASS,
                  "bg-primary/10 text-primary",
                  model.tagColor,
                )}
              >
                {model.tag}
              </span>
            )}
            {isLocked && (
              <LockIcon className="size-3.5 text-muted-foreground shrink-0" />
            )}
            {isSelected && (
              <CheckIcon className="size-3.5 text-primary shrink-0" />
            )}
          </span>
        </div>
      </DropdownMenuItem>
    );

    if (!model.description) {
      return item;
    }

    return (
      <Tooltip key={`${providerId}-${model.apiName}`}>
        <TooltipTrigger render={item} />
        <TooltipContent side="right" align="start">
          <span className="max-w-64">{model.description}</span>
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderProviderSubmenu = (
    providerId: string,
    models: LanguageModel[],
  ) => {
    const visibleModels = models;
    if (visibleModels.length === 0) {
      return null;
    }
    const provider = providers?.find((p) => p.id === providerId);
    const providerDisplayName = getProviderDisplayName(providerId);

    return (
      <DropdownMenuSub key={providerId}>
        <DropdownMenuSubTrigger className="w-full font-normal">
          <div className="flex flex-col items-start w-full">
            <div className="flex items-center gap-2">
              <span>{providerDisplayName}</span>
              {provider?.type === "custom" && (
                <span className={cn(PILL_CLASS, "bg-amber-500 text-white")}>
                  Custom
                </span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {visibleModels.length} models
            </span>
          </div>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className={cn("w-64", SCROLL_AREA_CLASS)}>
          <DropdownMenuLabel>
            {providerDisplayName + " Models"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {visibleModels.map((model) =>
            renderCloudModelItem({ providerId, model }),
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    );
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={handleOpenChange}>
        <DropdownMenuTrigger
          className="inline-flex items-center justify-center whitespace-nowrap rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 border-none bg-transparent shadow-none text-foreground/80 hover:text-foreground hover:bg-muted/60 h-7 max-w-[130px] px-2 gap-1.5 cursor-pointer"
          data-testid="model-picker"
          title={modelDisplayName}
        >
          <span className="truncate">
            {modelDisplayName === "Auto" && (
              <>
                <span className="text-xs text-muted-foreground/70">
                  Model:
                </span>{" "}
              </>
            )}
            {modelDisplayName}
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-[17rem]" align="start">
          {loading ? (
            <div className="text-xs text-center py-2 text-muted-foreground">
              Loading models...
            </div>
          ) : !modelsByProviders ||
            Object.keys(modelsByProviders).length === 0 ? (
            <div className="text-xs text-center py-2 text-muted-foreground">
              No cloud models available
            </div>
          ) : (
            /* Cloud models loaded */
            <>
              {(() => {
                const groups = PRICE_TIERS.map((tier) => ({
                  tier,
                  entries: flatModelEntries
                    .filter((e) => tierFor(e.model.dollarSigns) === tier)
                    // Stable-sort OpenAI to the top of each tier.
                    .sort(
                      (a, b) =>
                        (a.providerId === "openai" ? 0 : 1) -
                        (b.providerId === "openai" ? 0 : 1),
                    ),
                })).filter((g) => g.entries.length > 0);

                const nodes: ReactNode[] = [];
                groups.forEach(({ tier, entries }, i) => {
                  if (i > 0) {
                    nodes.push(
                      <DropdownMenuSeparator key={`tier-sep-${tier.label}`} />,
                    );
                  }
                  nodes.push(
                    <div
                      key={`tier-label-${tier.label}`}
                      className="flex items-center gap-1.5 px-2 pt-1.5 pb-1"
                    >
                      <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground shrink-0">
                        {tier.label}
                      </span>
                      <span
                        aria-hidden="true"
                        className="size-[3px] rounded-full bg-muted-foreground/50 shrink-0"
                      />
                      <span className="text-[11px] text-muted-foreground/85 truncate">
                        {tier.caption}
                      </span>
                    </div>,
                  );
                  entries.forEach(({ providerId, model }) => {
                    nodes.push(renderCloudModelItem({ providerId, model }));
                  });
                });
                return nodes;
              })()}
              {groupedProviders.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className="w-full font-normal">
                      <span>More models</span>
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent
                      className={cn("w-64", SCROLL_AREA_CLASS)}
                    >
                      <DropdownMenuLabel>More models</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {groupedProviders.map(([providerId, models]) =>
                        renderProviderSubmenu(providerId, models),
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </>
              )}
            </>
          )}

          <>
            <DropdownMenuSeparator />
            {/* Local Models Parent SubMenu */}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="w-full font-normal">
                <span>Local models</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-64">
                {/* Ollama Models SubMenu */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    disabled={ollamaLoading && !hasOllamaModels} // Disable if loading and no models yet
                    className="w-full font-normal"
                  >
                    <div className="flex flex-col items-start">
                      <span>Ollama</span>
                      {ollamaLoading ? (
                        <span className="text-xs text-muted-foreground">
                          Loading...
                        </span>
                      ) : ollamaError ? (
                        <span className="text-xs text-red-500">
                          Error loading
                        </span>
                      ) : !hasOllamaModels ? (
                        <span className="text-xs text-muted-foreground">
                          None available
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {ollamaModels.length} models
                        </span>
                      )}
                    </div>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    className={cn("w-64", SCROLL_AREA_CLASS)}
                  >
                    <DropdownMenuLabel>Ollama Models</DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    {ollamaLoading && ollamaModels.length === 0 ? ( // Show loading only if no models are loaded yet
                      <div className="text-xs text-center py-2 text-muted-foreground">
                        Loading models...
                      </div>
                    ) : ollamaError ? (
                      <div className="px-2 py-1.5 text-sm text-red-600">
                        <div className="flex flex-col">
                          <span>Error loading models</span>
                          <span className="text-xs text-muted-foreground">
                            Is Ollama running?
                          </span>
                        </div>
                      </div>
                    ) : !hasOllamaModels ? (
                      <div className="px-2 py-1.5 text-sm">
                        <div className="flex flex-col">
                          <span>No local models found</span>
                          <span className="text-xs text-muted-foreground">
                            Ensure Ollama is running and models are pulled.
                          </span>
                        </div>
                      </div>
                    ) : (
                      ollamaModels.map((model: LocalModel) => {
                        const isSelected =
                          selectedModel.provider === "ollama" &&
                          selectedModel.name === model.modelName;
                        return (
                          <DropdownMenuItem
                            key={`ollama-${model.modelName}`}
                            className={cn(
                              "relative py-1.5",
                              isSelected &&
                                "bg-primary/8 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary",
                            )}
                            onClick={() => {
                              void onModelSelect({
                                name: model.modelName,
                                provider: "ollama",
                              });
                              setOpen(false);
                            }}
                          >
                            <div className="flex w-full items-center gap-2">
                              <ProviderIcon providerId="ollama" />
                              <div className="min-w-0 flex flex-col">
                                <span className="text-[13px] leading-tight">
                                  {model.displayName}
                                </span>
                                <span className="text-xs text-muted-foreground truncate">
                                  {model.modelName}
                                </span>
                              </div>
                              {isSelected && (
                                <CheckIcon className="ml-auto size-3.5 text-primary shrink-0" />
                              )}
                            </div>
                          </DropdownMenuItem>
                        );
                      })
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {/* LM Studio Models SubMenu */}
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger
                    disabled={lmStudioLoading && !hasLMStudioModels} // Disable if loading and no models yet
                    className="w-full font-normal"
                  >
                    <div className="flex flex-col items-start">
                      <span>LM Studio</span>
                      {lmStudioLoading ? (
                        <span className="text-xs text-muted-foreground">
                          Loading...
                        </span>
                      ) : lmStudioError ? (
                        <span className="text-xs text-red-500">
                          Error loading
                        </span>
                      ) : !hasLMStudioModels ? (
                        <span className="text-xs text-muted-foreground">
                          None available
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          {lmStudioModels.length} models
                        </span>
                      )}
                    </div>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent
                    className={cn("w-64", SCROLL_AREA_CLASS)}
                  >
                    <DropdownMenuLabel>LM Studio Models</DropdownMenuLabel>
                    <DropdownMenuSeparator />

                    {lmStudioLoading && lmStudioModels.length === 0 ? ( // Show loading only if no models are loaded yet
                      <div className="text-xs text-center py-2 text-muted-foreground">
                        Loading models...
                      </div>
                    ) : lmStudioError ? (
                      <div className="px-2 py-1.5 text-sm text-red-600">
                        <div className="flex flex-col">
                          <span>Error loading models</span>
                          <span className="text-xs text-muted-foreground">
                            {lmStudioError.message}{" "}
                            {/* Display specific error */}
                          </span>
                        </div>
                      </div>
                    ) : !hasLMStudioModels ? (
                      <div className="px-2 py-1.5 text-sm">
                        <div className="flex flex-col">
                          <span>No loaded models found</span>
                          <span className="text-xs text-muted-foreground">
                            Ensure LM Studio is running and models are loaded.
                          </span>
                        </div>
                      </div>
                    ) : (
                      lmStudioModels.map((model: LocalModel) => {
                        const isSelected =
                          selectedModel.provider === "lmstudio" &&
                          selectedModel.name === model.modelName;
                        return (
                          <DropdownMenuItem
                            key={`lmstudio-${model.modelName}`}
                            className={cn(
                              "relative py-1.5",
                              isSelected &&
                                "bg-primary/8 before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-primary",
                            )}
                            onClick={() => {
                              void onModelSelect({
                                name: model.modelName,
                                provider: "lmstudio",
                              });
                              setOpen(false);
                            }}
                          >
                            <div className="flex w-full items-center gap-2">
                              <ProviderIcon providerId="lmstudio" />
                              <div className="min-w-0 flex flex-col">
                                <span className="text-[13px] leading-tight">
                                  {model.displayName}
                                </span>
                                <span className="text-xs text-muted-foreground truncate">
                                  {model.modelName}
                                </span>
                              </div>
                              {isSelected && (
                                <CheckIcon className="ml-auto size-3.5 text-primary shrink-0" />
                              )}
                            </div>
                          </DropdownMenuItem>
                        );
                      })
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Unlock dialog for locked models */}
      <Dialog
        open={unlockTarget !== null}
        onOpenChange={(dialogOpen) => {
          if (!dialogOpen) {
            setUnlockTarget(null);
          }
        }}
      >
        <DialogContent
          className="sm:max-w-md"
          data-testid="unlock-model-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              Add a {unlockTargetProviderName} API key to use{" "}
              {unlockTarget?.model.displayName}
            </DialogTitle>
            <DialogDescription>
              Configure the provider in settings before selecting this cloud
              model.
            </DialogDescription>
          </DialogHeader>
          <Button
            className="cursor-pointer w-full"
            onClick={handleUnlockDialogOwnKeyClick}
          >
            Open provider settings
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
