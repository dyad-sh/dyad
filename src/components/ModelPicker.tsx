import type { LargeLanguageModel, ModelProvider } from "@/lib/schemas";
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
import { ChevronDown } from "lucide-react";
import { LocalModel } from "@/ipc/ipc_types";
interface ModelPickerProps {
  selectedModel: LargeLanguageModel;
  onModelSelect: (model: LargeLanguageModel) => void;
}

export function ModelPicker({
  selectedModel,
  onModelSelect,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);

  // Cloud models from providers
  const { data: modelsByProviders, isLoading: providersLoading } =
    useLanguageModelsByProviders();

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

  const modelDisplayName = getModelDisplayName();

  // Flatten the cloud models from all providers
  const cloudModels =
    !providersLoading && modelsByProviders
      ? Object.entries(modelsByProviders).flatMap(([providerId, models]) =>
          models.map((model) => ({
            name: model.apiName,
            displayName: model.displayName,
            description: model.description || "",
            tag: model.tag,
            provider: providerId as ModelProvider,
          })),
        )
      : [];

  // Determine availability of local models
  const hasOllamaModels =
    !ollamaLoading && !ollamaError && ollamaModels.length > 0;
  const hasLMStudioModels =
    !lmStudioLoading && !lmStudioError && lmStudioModels.length > 0;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-2 h-8"
        >
          <span>
            <span className="text-xs text-muted-foreground">Model:</span>{" "}
            {modelDisplayName}
          </span>
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="start">
        {" "}
        {/* Increased width slightly */}
        <DropdownMenuLabel>Cloud Models</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* Cloud models - loading state */}
        {providersLoading ? (
          <div className="text-xs text-center py-2 text-muted-foreground">
            Loading models...
          </div>
        ) : cloudModels.length === 0 ? (
          <div className="text-xs text-center py-2 text-muted-foreground">
            No cloud models available
          </div>
        ) : (
          /* Cloud models loaded */
          cloudModels.map((model) => (
            <Tooltip key={`${model.provider}-${model.name}`}>
              <TooltipTrigger asChild>
                <DropdownMenuItem
                  className={
                    selectedModel.provider === model.provider &&
                    selectedModel.name === model.name
                      ? "bg-secondary"
                      : ""
                  }
                  onClick={() => {
                    onModelSelect({
                      name: model.name,
                      provider: model.provider,
                    });
                    setOpen(false);
                  }}
                >
                  <div className="flex justify-between items-start w-full">
                    <span className="flex flex-col items-start">
                      <span>{model.displayName}</span>
                      <span className="text-xs text-muted-foreground">
                        {model.provider}
                      </span>
                    </span>
                    {model.tag && (
                      <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                        {model.tag}
                      </span>
                    )}
                  </div>
                </DropdownMenuItem>
              </TooltipTrigger>
              <TooltipContent side="right">{model.description}</TooltipContent>
            </Tooltip>
          ))
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
              <DropdownMenuSubContent className="w-56">
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
              <DropdownMenuSubContent className="w-56">
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
