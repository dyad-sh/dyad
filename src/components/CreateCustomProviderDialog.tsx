import React, { useState, useEffect } from "react";
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
import type { LanguageModelProvider } from "@/ipc/types";
import { useTranslation } from "react-i18next";

interface CreateCustomProviderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editingProvider?: LanguageModelProvider | null;
}

export function CreateCustomProviderDialog({
  isOpen,
  onClose,
  onSuccess,
  editingProvider = null,
}: CreateCustomProviderDialogProps) {
  const { t } = useTranslation(["settings", "common"]);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [envVarName, setEnvVarName] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const isEditMode = Boolean(editingProvider);

  const { createProvider, editProvider, isCreating, isEditing, error } =
    useCustomLanguageModelProvider();
  // Load provider data when editing
  useEffect(() => {
    if (editingProvider && isOpen) {
      const cleanId = editingProvider.id?.startsWith("custom::")
        ? editingProvider.id.replace("custom::", "")
        : editingProvider.id || "";
      setId(cleanId);
      setName(editingProvider.name || "");
      setApiBaseUrl(editingProvider.apiBaseUrl || "");
      setEnvVarName(editingProvider.envVarName || "");
    } else if (!isOpen) {
      // Reset form when dialog closes
      setId("");
      setName("");
      setApiBaseUrl("");
      setEnvVarName("");
      setErrorMessage("");
    }
  }, [editingProvider, isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage("");

    try {
      if (isEditMode && editingProvider) {
        const cleanId = editingProvider.id?.startsWith("custom::")
          ? editingProvider.id.replace("custom::", "")
          : editingProvider.id || "";
        await editProvider({
          id: cleanId,
          name: name.trim(),
          apiBaseUrl: apiBaseUrl.trim(),
          envVarName: envVarName.trim() || undefined,
        });
      } else {
        await createProvider({
          id: id.trim(),
          name: name.trim(),
          apiBaseUrl: apiBaseUrl.trim(),
          envVarName: envVarName.trim() || undefined,
        });
      }

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
          : t("customProvider.failedCreate"),
      );
    }
  };

  const handleClose = () => {
    if (!isCreating && !isEditing) {
      setErrorMessage("");
      onClose();
    }
  };
  const isLoading = isCreating || isEditing;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {t(
              isEditMode
                ? "customProvider.editTitle"
                : "customProvider.addTitle",
            )}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? t("customProvider.editDescription")
              : t("customProvider.addDescription")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="id">{t("customProvider.providerId")}</Label>
            <Input
              id="id"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder={t("customProvider.providerIdPlaceholder")}
              required
              disabled={isLoading || isEditMode}
            />
            <p className="text-xs text-muted-foreground">
              {t("customProvider.providerIdHelp")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="name">{t("customProvider.displayName")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("customProvider.displayNamePlaceholder")}
              required
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              {t("customProvider.displayNameHelp")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiBaseUrl">{t("customProvider.apiBaseUrl")}</Label>
            <Input
              id="apiBaseUrl"
              value={apiBaseUrl}
              onChange={(e) => setApiBaseUrl(e.target.value)}
              placeholder={t("customProvider.apiBaseUrlPlaceholder")}
              required
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              {t("customProvider.apiBaseUrlHelp")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="envVarName">{t("customProvider.envVar")}</Label>
            <Input
              id="envVarName"
              value={envVarName}
              onChange={(e) => setEnvVarName(e.target.value)}
              placeholder={t("customProvider.envVarPlaceholder")}
              disabled={isLoading}
            />
            <p className="text-xs text-muted-foreground">
              {t("customProvider.envVarHelp")}
            </p>
          </div>

          {(errorMessage || error) && (
            <div className="text-sm text-red-500">
              {errorMessage ||
                (error instanceof Error
                  ? error.message
                  : t("customProvider.failedCreate"))}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              {t("common:cancel")}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isLoading
                ? isEditMode
                  ? t("common:updating")
                  : t("common:adding")
                : isEditMode
                  ? t("customProvider.updateProvider")
                  : t("customProvider.addProvider")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
