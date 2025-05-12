import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { useCustomLanguageModelProvider } from "@/hooks/useCustomLanguageModelProvider";

interface CreateCustomProviderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateCustomProviderDialog({
  isOpen,
  onClose,
  onSuccess,
}: CreateCustomProviderDialogProps) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [envVarName, setEnvVarName] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const { createProvider, isCreating, error } =
    useCustomLanguageModelProvider();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    try {
      await createProvider({
        id: id.trim(),
        name: name.trim(),
        apiBaseUrl: apiBaseUrl.trim(),
        envVarName: envVarName.trim() || undefined,
      });

      // Reset form
      setId("");
      setName("");
      setApiBaseUrl("");
      setEnvVarName("");

      onSuccess();
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Failed to create custom provider",
      );
    }
  };

  const handleClose = () => {
    if (!isCreating) {
      setErrorMessage("");
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Custom Provider</DialogTitle>
          <DialogDescription>
            Connect to a custom language model provider API
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="id">Provider ID</Label>
            <Input
              id="id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="E.g., my-provider"
              required
              disabled={isCreating}
            />
            <p className="text-xs text-muted-foreground">
              A unique identifier for this provider (no spaces).
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">Display Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="E.g., My Provider"
              required
              disabled={isCreating}
            />
            <p className="text-xs text-muted-foreground">
              The name that will be displayed in the UI.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiBaseUrl">API Base URL</Label>
            <Input
              id="apiBaseUrl"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder="E.g., https://api.example.com/v1"
              required
              disabled={isCreating}
            />
            <p className="text-xs text-muted-foreground">
              The base URL for the API endpoint.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="envVarName">Environment Variable (Optional)</Label>
            <Input
              id="envVarName"
              value={envVarName}
              onChange={(e) => setEnvVarName(e.target.value)}
              placeholder="E.g., MY_PROVIDER_API_KEY"
              disabled={isCreating}
            />
            <p className="text-xs text-muted-foreground">
              Environment variable name for the API key.
            </p>
          </div>

          {(errorMessage || error) && (
            <div className="text-sm text-red-500">
              {errorMessage ||
                (error instanceof Error
                  ? error.message
                  : "Failed to create custom provider")}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isCreating}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isCreating ? "Adding..." : "Add Provider"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
