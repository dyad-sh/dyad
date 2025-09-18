import { isDyadProEnabled, type LargeLanguageModel } from "@/lib/schemas";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
import { useEffect, useState } from "react";
import { useLocalModels } from "@/hooks/useLocalModels";
import { useLocalLMSModels } from "@/hooks/useLMStudioModels";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";

import { LocalModel } from "@/ipc/ipc_types";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useSettings } from "@/hooks/useSettings";
import { PriceBadge } from "@/components/PriceBadge";
import { TURBO_MODELS } from "@/ipc/shared/language_model_constants";

export function ModelPicker() {
  const { settings, updateSettings } = useSettings();
  const onModelSelect = (model: LargeLanguageModel) => {
    updateSettings({ selectedModel: model });
  };

  const [open, setOpen] = useState(false);

  // Cloud models from providers
  const { data: modelsByProviders, isLoading: modelsByProvidersLoading } =
    useLanguageModelsByProviders();

  const { data: providers, isLoading: providersLoading } =
    useLanguageModelProviders();

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

  // Get auto provider models (if any)
  const autoModels =
    !loading && modelsByProviders && modelsByProviders["auto"]
      ? modelsByProviders["auto"].filter((model) => {
          if (
            settings &&
            !isDyadProEnabled(settings) &&
            model.apiName === "turbo"
          ) {
            return false;
          }
          if (
            settings &&
            isDyadProEnabled(settings) &&
            model.apiName === "free"
          ) {
            return false;
          }
          return true;
        })
      : [];

  // Determine availability of local models
  const hasOllamaModels =
    !ollamaLoading && !ollamaError && ollamaModels.length > 0;
  const hasLMStudioModels =
    !lmStudioLoading && !lmStudioError && lmStudioModels.length > 0;

  if (!settings) {
    return null;
  }
  const selectedModel = settings?.selectedModel;
  const isSmartAutoEnabled =
    settings.enableProSmartFilesContextMode && isDyadProEnabled(settings);
  const modelDisplayName = getModelDisplayName();
  // Split providers into primary and secondary groups (excluding auto)
  const providerEntries =
    !loading && modelsByProviders
      ? Object.entries(modelsByProviders).filter(
          ([providerId]) => providerId !== "auto",
        )
      : [];
  const primaryProviders = providerEntries.filter(([providerId, models]) => {
    if (models.length === 0) return false;
    const provider = providers?.find((p) => p.id === providerId);
    return !(provider && provider.secondary);
  });
  if (settings && isDyadProEnabled(settings)) {
    primaryProviders.unshift(["auto", TURBO_MODELS]);
  }
  const secondaryProviders = providerEntries.filter(([providerId, models]) => {
    if (models.length === 0) return false;
    const provider = providers?.find((p) => p.id === providerId);
    return !!(provider && provider.secondary);
  });

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2 h-8 max-w-[130px] px-1.5 text-xs-sm"
            >
              <span className="truncate">
                {modelDisplayName === "Auto" && (
                  <>
                    <span className="text-xs text-muted-foreground">
                      Model:
                    </span>{" "}
                  </>
                )}
                {modelDisplayName}
              </span>
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{modelDisplayName}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        className="w-64"
        align="start"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuLabel>Cloud Models</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Cloud models - loading state */}
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
            {/* Auto models at top level if any */}
            {autoModels.length > 0 && (
              <>
                {autoModels.map((model) => (
                  <Tooltip key={`auto-${model.apiName}`}>
                    <TooltipTrigger asChild>
                      <DropdownMenuItem
                        className={
                          selectedModel.provider === "auto" &&
                          selectedModel.name === model.apiName
                            ? "bg-secondary"
                            : ""
                        }
                        onClick={() => {
                          onModelSelect({
                            name: model.apiName,
                            provider: "auto",
                          });
                          setOpen(false);
                        }}
                      >
                        <div className="flex justify-between items-start w-full">
                          <span className="flex flex-col items-start">
                            <span>
                              {isSmartAutoEnabled && model.apiName === "auto"
                                ? "Smart Auto"
                                : model.displayName}
                            </span>
                          </span>
                          <div className="flex items-center gap-1.5">
                            {isSmartAutoEnabled && (
                              <span className="text-[10px] bg-gradient-to-r from-indigo-600 via-indigo-500 to-indigo-600 bg-[length:200%_100%] animate-[shimmer_5s_ease-in-out_infinite] text-white px-1.5 py-0.5 rounded-full font-medium">
                                Pro only
                              </span>
                            )}
                            {model.tag && (
                              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                                {model.tag}
                              </span>
                            )}
                          </div>
                        </div>
                      </DropdownMenuItem>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {isSmartAutoEnabled && model.apiName === "auto" ? (
                        <p>
                          <strong>Smart Auto</strong> uses a cheaper model for
                          easier tasks
                          <br /> and a flagship model for harder tasks
                        </p>
                      ) : (
                        model.description
                      )}
                    </TooltipContent>
                  </Tooltip>
                ))}
                {Object.keys(modelsByProviders).length > 1 && (
                  <DropdownMenuSeparator />
                )}
              </>
            )}

            {/* Primary providers as submenus */}
            {primaryProviders.map(([providerId, models]) => {
              models = models.filter((model) => {
                // Don't show free models if Dyad Pro is enabled because
                // we will use the paid models (in Dyad Pro backend) which
                // don't have the free limitations.
                if (
                  isDyadProEnabled(settings) &&
                  model.apiName.endsWith(":free")
                ) {
                  return false;
                }
                return true;
              });
              const provider = providers?.find((p) => p.id === providerId);
              const providerDisplayName =
                provider?.id === "auto"
                  ? "Dyad Turbo"
                  : (provider?.name ?? providerId);
              return (
                <DropdownMenuSub key={providerId}>
                  <DropdownMenuSubTrigger className="w-full font-normal">
                    <div className="flex flex-col items-start w-full">
                      <div className="flex items-center gap-2">
                        <span>{providerDisplayName}</span>
                        {provider?.type === "cloud" &&
                          !provider?.secondary &&
                          isDyadProEnabled(settings) && (
                            <span className="text-[10px] bg-gradient-to-r from-indigo-600 via-indigo-500 to-indigo-600 bg-[length:200%_100%] animate-[shimmer_5s_ease-in-out_infinite] text-white px-1.5 py-0.5 rounded-full font-medium">
                              Pro
                            </span>
                          )}
                        {provider?.type === "custom" && (
                          <span className="text-[10px] bg-amber-500/20 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                            Custom
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {models.length} models
                      </span>
                    </div>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="w-56 max-h-100 overflow-y-auto">
                    <DropdownMenuLabel>
                      {providerDisplayName + " Models"}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {models.map((model) => (
                      <Tooltip key={`${providerId}-${model.apiName}`}>
                        <TooltipTrigger asChild>
                          <DropdownMenuItem
                            className={
                              selectedModel.provider === providerId &&
                              selectedModel.name === model.apiName
                                ? "bg-secondary"
                                : ""
                            }
                            onClick={() => {
                              const customModelId =
                                model.type === "custom" ? model.id : undefined;
                              onModelSelect({
                                name: model.apiName,
                                provider: providerId,
                                customModelId,
                              });
                              setOpen(false);
                            }}
                          >
                            <div className="flex justify-between items-start w-full">
                              <span>{model.displayName}</span>
                              <PriceBadge dollarSigns={model.dollarSigns} />
                              {model.tag && (
                                <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                                  {model.tag}
                                </span>
                              )}
                            </div>
                          </DropdownMenuItem>
                        </TooltipTrigger>
                        <TooltipContent side="right">
                          {model.description}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            })}

            {/* Secondary providers grouped under Other AI providers */}
            {secondaryProviders.length > 0 && (
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="w-full font-normal">
                  <div className="flex flex-col items-start">
                    <span>Other AI providers</span>
                    <span className="text-xs text-muted-foreground">
                      {secondaryProviders.length} providers
                    </span>
                  </div>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuLabel>Other AI providers</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {secondaryProviders.map(([providerId, models]) => {
                    const provider = providers?.find(
                      (p) => p.id === providerId,
                    );
                    return (
                      <DropdownMenuSub key={providerId}>
                        <DropdownMenuSubTrigger className="w-full font-normal">
                          <div className="flex flex-col items-start w-full">
                            <div className="flex items-center gap-2">
                              <span>{provider?.name ?? providerId}</span>
                              {provider?.type === "custom" && (
                                <span className="text-[10px] bg-amber-500/20 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">
                                  Custom
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {models.length} models
                            </span>
                          </div>
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent className="w-56">
                          <DropdownMenuLabel>
                            {(provider?.name ?? providerId) + " Models"}
                          </DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {models.map((model) => (
                            <Tooltip key={`${providerId}-${model.apiName}`}>
                              <TooltipTrigger asChild>
                                <DropdownMenuItem
                                  className={
                                    selectedModel.provider === providerId &&
                                    selectedModel.name === model.apiName
                                      ? "bg-secondary"
                                      : ""
                                  }
                                  onClick={() => {
                                    const customModelId =
                                      model.type === "custom"
                                        ? model.id
                                        : undefined;
                                    onModelSelect({
                                      name: model.apiName,
                                      provider: providerId,
                                      customModelId,
                                    });
                                    setOpen(false);
                                  }}
                                >
                                  <div className="flex justify-between items-start w-full">
                                    <span>{model.displayName}</span>
                                    {model.tag && (
                                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                                        {model.tag}
                                      </span>
                                    )}
                                  </div>
                                </DropdownMenuItem>
                              </TooltipTrigger>
                              <TooltipContent side="right">
                                {model.description}
                              </TooltipContent>
                            </Tooltip>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            )}
          </>
        )}

        <DropdownMenuSeparator />
        {/* Local Models Parent SubMenu */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="w-full font-normal">
            <div className="flex flex-col items-start">
              <span>Local models</span>
              <span className="text-xs text-muted-foreground">
                LM Studio, Ollama
              </span>
            </div>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
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
                    <span className="text-xs text-red-500">Error loading</span>
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
              <DropdownMenuSubContent className="w-56 max-h-100 overflow-y-auto">
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
                  ollamaModels.map((model: LocalModel) => (
                    <DropdownMenuItem
                      key={`ollama-${model.modelName}`}
                      className={
                        selectedModel.provider === "ollama" &&
                        selectedModel.name === model.modelName
                          ? "bg-secondary"
                          : ""
                      }
                      onClick={() => {
                        onModelSelect({
                          name: model.modelName,
                          provider: "ollama",
                        });
                        setOpen(false);
                      }}
                    >
                      <div className="flex flex-col">
                        <span>{model.displayName}</span>
                        <span className="text-xs text-muted-foreground truncate">
                          {model.modelName}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  ))
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
                    <span className="text-xs text-red-500">Error loading</span>
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
              <DropdownMenuSubContent className="w-56 max-h-100 overflow-y-auto">
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
                        {lmStudioError.message} {/* Display specific error */}
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
                  lmStudioModels.map((model: LocalModel) => (
                    <DropdownMenuItem
                      key={`lmstudio-${model.modelName}`}
                      className={
                        selectedModel.provider === "lmstudio" &&
                        selectedModel.name === model.modelName
                          ? "bg-secondary"
                          : ""
                      }
                      onClick={() => {
                        onModelSelect({
                          name: model.modelName,
                          provider: "lmstudio",
                        });
                        setOpen(false);
                      }}
                    >
                      <div className="flex flex-col">
                        {/* Display the user-friendly name */}
                        <span>{model.displayName}</span>
                        {/* Show the path as secondary info */}
                        <span className="text-xs text-muted-foreground truncate">
                          {model.modelName}
                        </span>
                      </div>
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
