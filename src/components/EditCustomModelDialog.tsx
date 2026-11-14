import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ipc } from "@/ipc/types";
import type { EffortSettings } from "@/ipc/types/language-model";
import {
  formatEffortLevelsInput,
  parseEffortLevelsInput,
} from "@/lib/modelEffort";
import { useSettings } from "@/hooks/useSettings";
import { useMutation } from "@tanstack/react-query";
import { showError, showSuccess } from "@/lib/toast";
import { replaceRecentModelIdentity } from "@/lib/recentModels";

interface Model {
  id?: number;
  apiName: string;
  displayName: string;
  description?: string;
  maxOutputTokens?: number;
  contextWindow?: number;
  effortSettings?: EffortSettings;
  type: "cloud" | "custom";
  tag?: string;
}

interface EditCustomModelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  providerId: string;
  model: Model | null;
  models?: Array<{
    id?: number;
    apiName: string;
    type?: "cloud" | "custom" | "local";
  }>;
}

export function EditCustomModelDialog({
  isOpen,
  onClose,
  onSuccess,
  providerId,
  model,
  models,
}: EditCustomModelDialogProps) {
  const [apiName, setApiName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState<string>("");
  const [contextWindow, setContextWindow] = useState<string>("");
  const [effortLevels, setEffortLevels] = useState("");
  const { settings, updateSettings } = useSettings();

  useEffect(() => {
    if (model) {
      setApiName(model.apiName);
      setDisplayName(model.displayName);
      setDescription(model.description || "");
      setMaxOutputTokens(model.maxOutputTokens?.toString() || "");
      setContextWindow(model.contextWindow?.toString() || "");
      setEffortLevels(formatEffortLevelsInput(model.effortSettings));
    }
  }, [model]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!model) throw new Error("No model to edit");
      if (model.id === undefined) throw new Error("Custom model ID is missing");

      const newParams = {
        apiName,
        displayName,
        providerId,
        description: description || undefined,
        maxOutputTokens: maxOutputTokens
          ? parseInt(maxOutputTokens, 10)
          : undefined,
        contextWindow: contextWindow ? parseInt(contextWindow, 10) : undefined,
      };

      if (!newParams.apiName) throw new Error("Model API name is required");
      if (!newParams.displayName)
        throw new Error("Model display name is required");
      if (maxOutputTokens && isNaN(newParams.maxOutputTokens ?? NaN))
        throw new Error("Max Output Tokens must be a valid number");
      if (contextWindow && isNaN(newParams.contextWindow ?? NaN))
        throw new Error("Context Window must be a valid number");

      return ipc.languageModel.updateCustomModel({
        id: model.id,
        providerId: newParams.providerId,
        displayName: newParams.displayName,
        apiName: newParams.apiName,
        description: newParams.description,
        maxOutputTokens: newParams.maxOutputTokens,
        contextWindow: newParams.contextWindow,
        effortSettings:
          parseEffortLevelsInput(effortLevels, model.effortSettings) ?? null,
      });
    },
    onSuccess: async (customModelId) => {
      if (!model) return;
      if (settings) {
        const legacyResolvedModel = models?.find(
          (candidate) => candidate.apiName === model.apiName,
        );
        const includeLegacyIdless =
          legacyResolvedModel?.type === "custom" &&
          legacyResolvedModel.id === model.id;
        const previousModel = {
          provider: providerId,
          name: model.apiName,
          customModelId: model.id,
        };
        const replacementModel = {
          provider: providerId,
          name: apiName,
          customModelId,
        };
        const [selectedModel] = replaceRecentModelIdentity(
          [settings.selectedModel],
          previousModel,
          replacementModel,
          { includeLegacyIdless },
        )!;
        const recentModels = replaceRecentModelIdentity(
          settings.recentModels,
          previousModel,
          replacementModel,
          { includeLegacyIdless },
        );
        const selectedModelChanged = selectedModel !== settings.selectedModel;
        const recentModelsChanged = recentModels?.some(
          (recentModel, index) =>
            recentModel !== settings.recentModels?.[index],
        );
        if (selectedModelChanged || recentModelsChanged) {
          try {
            await updateSettings({
              ...(selectedModelChanged ? { selectedModel } : {}),
              ...(recentModelsChanged ? { recentModels } : {}),
            });
          } catch {
            showError("Failed to update settings");
            return; // stop closing dialog
          }
        }
      }
      showSuccess("Custom model updated successfully!");
      onSuccess();
      onClose();
    },
    onError: (error) => {
      showError(error);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const handleClose = () => {
    if (!mutation.isPending) {
      onClose();
    }
  };

  if (!model) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Edit Custom Model</DialogTitle>
          <DialogDescription>
            Modify the configuration of the selected language model.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-model-id" className="text-right">
                Model ID*
              </Label>
              <Input
                id="edit-model-id"
                value={apiName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setApiName(e.target.value)
                }
                className="col-span-3"
                placeholder="This must match the model expected by the API"
                required
                disabled={mutation.isPending}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-model-name" className="text-right">
                Name*
              </Label>
              <Input
                id="edit-model-name"
                value={displayName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDisplayName(e.target.value)
                }
                className="col-span-3"
                placeholder="Human-friendly name for the model"
                required
                disabled={mutation.isPending}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-description" className="text-right">
                Description
              </Label>
              <Input
                id="edit-description"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDescription(e.target.value)
                }
                className="col-span-3"
                placeholder="Optional: Describe the model's capabilities"
                disabled={mutation.isPending}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-max-output-tokens" className="text-right">
                Max Output Tokens
              </Label>
              <Input
                id="edit-max-output-tokens"
                type="number"
                value={maxOutputTokens}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setMaxOutputTokens(e.target.value)
                }
                className="col-span-3"
                placeholder="Optional: e.g., 4096"
                disabled={mutation.isPending}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-context-window" className="text-right">
                Context Window
              </Label>
              <Input
                id="edit-context-window"
                type="number"
                value={contextWindow}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setContextWindow(e.target.value)
                }
                className="col-span-3"
                placeholder="Optional: e.g., 8192"
                disabled={mutation.isPending}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="edit-effort-levels" className="text-right">
                Effort Levels
              </Label>
              <div className="col-span-3 space-y-1">
                <Input
                  id="edit-effort-levels"
                  value={effortLevels}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setEffortLevels(e.target.value)
                  }
                  placeholder="Optional: e.g., xhigh, medium, low"
                  disabled={mutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated; the first is the default. Leave empty to use
                  this provider's default effort levels.
                </p>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={mutation.isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Updating..." : "Update Model"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
