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
import { MODEL_OPTIONS } from "@/constants/models";
import { useLocalModels } from "@/hooks/useLocalModels";
import { ChevronDown } from "lucide-react";

interface ModelPickerProps {
  selectedModel: LargeLanguageModel;
  onModelSelect: (model: LargeLanguageModel) => void;
}

export function ModelPicker({
  selectedModel,
  onModelSelect,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const {
    models: localModels,
    loading: localModelsLoading,
    error: localModelsError,
    loadModels,
  } = useLocalModels();

  // Load local models when the component mounts or the dropdown opens
  useEffect(() => {
    if (open) {
      loadModels();
    }
  }, [open, loadModels]);

  // Get display name for the selected model
  const getModelDisplayName = () => {
    if (selectedModel.provider === "ollama") {
      return (
        localModels.find((model) => model.modelName === selectedModel.name)
          ?.displayName || selectedModel.name
      );
    }

    return (
      MODEL_OPTIONS[selectedModel.provider]?.find(
        (model) => model.name === selectedModel.name
      )?.displayName || selectedModel.name
    );
  };

  const modelDisplayName = getModelDisplayName();

  // Flatten the model options into a single array with provider information
  const allModels = Object.entries(MODEL_OPTIONS).flatMap(
    ([provider, models]) =>
      models.map((model) => ({
        ...model,
        provider: provider as ModelProvider,
      }))
  );

  // Determine if we have local models available
  const hasLocalModels =
    !localModelsLoading && !localModelsError && localModels.length > 0;

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
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuLabel>Cloud Models</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Cloud models */}
        {allModels.map((model) => (
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
        ))}

        <DropdownMenuSeparator />

        {/* Ollama Models Dropdown */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            disabled={localModelsLoading || !hasLocalModels}
            className="w-full font-normal"
          >
            <div className="flex flex-col items-start">
              <span>Local models (Ollama)</span>
              {localModelsLoading ? (
                <span className="text-xs text-muted-foreground">
                  Loading...
                </span>
              ) : !hasLocalModels ? (
                <span className="text-xs text-muted-foreground">
                  None available
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {localModels.length} models
                </span>
              )}
            </div>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            <DropdownMenuLabel>Ollama Models</DropdownMenuLabel>
            <DropdownMenuSeparator />

            {localModelsLoading ? (
              <div className="text-xs text-center py-2 text-muted-foreground">
                Loading models...
              </div>
            ) : localModelsError ? (
              <div className="text-xs text-center py-2 text-muted-foreground">
                Error loading models
              </div>
            ) : localModels.length === 0 ? (
              <div className="px-2 py-1.5 text-sm">
                <div className="flex flex-col">
                  <span>No local models available</span>
                  <span className="text-xs text-muted-foreground">
                    Start Ollama to use local models
                  </span>
                </div>
              </div>
            ) : (
              localModels.map((model) => (
                <DropdownMenuItem
                  key={`local-${model.modelName}`}
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
