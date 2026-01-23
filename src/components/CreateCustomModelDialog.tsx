import React, { useState } from "react";
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
import { IpcClient } from "@/ipc/ipc_client";
import { useMutation } from "@tanstack/react-query";
import { showError, showSuccess } from "@/lib/toast";

interface CreateCustomModelDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  providerId: string;
}

export function CreateCustomModelDialog({
  isOpen,
  onClose,
  onSuccess,
  providerId,
}: CreateCustomModelDialogProps) {
  const [apiName, setApiName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState<string>("");
  const [contextWindow, setContextWindow] = useState<string>("");

  const ipcClient = IpcClient.getInstance();

  const mutation = useMutation({
    mutationFn: async () => {
      const params = {
        apiName,
        displayName,
        providerId,
        description: description || undefined,
        maxOutputTokens: maxOutputTokens
          ? parseInt(maxOutputTokens, 10)
          : undefined,
        contextWindow: contextWindow ? parseInt(contextWindow, 10) : undefined,
      };

      if (!params.apiName) throw new Error("Model API name is required");
      if (!params.displayName)
        throw new Error("Model display name is required");
      if (maxOutputTokens && isNaN(params.maxOutputTokens ?? NaN))
        throw new Error("Max Output Tokens must be a valid number");
      if (contextWindow && isNaN(params.contextWindow ?? NaN))
        throw new Error("Context Window must be a valid number");

      await ipcClient.createCustomLanguageModel(params);
    },
    onSuccess: () => {
      showSuccess("Custom model created successfully!");
      resetForm();
      onSuccess(); // Refetch or update UI
      onClose();
    },
    onError: (error) => {
      showError(error);
    },
  });

  const resetForm = () => {
    setApiName("");
    setDisplayName("");
    setDescription("");
    setMaxOutputTokens("");
    setContextWindow("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    mutation.mutate();
  };

  const handleClose = () => {
    if (!mutation.isPending) {
      resetForm();
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Add Custom Model</DialogTitle>
          <DialogDescription>
            Configure a new language model for the selected provider.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="model-id" className="text-right">
                Model ID*
              </Label>
              <Input
                id="model-id"
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
              <Label htmlFor="model-name" className="text-right">
                Name*
              </Label>
              <Input
                id="model-name"
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
              <Label htmlFor="description" className="text-right">
                Description
              </Label>
              <Input
                id="description"
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
              <Label htmlFor="max-output-tokens" className="text-right">
                Max Output Tokens
              </Label>
              <Input
                id="max-output-tokens"
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
              <Label htmlFor="context-window" className="text-right">
                Context Window
              </Label>
              <Input
                id="context-window"
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
              {mutation.isPending ? "Adding..." : "Add Model"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
