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
import { ipc } from "@/ipc/types";
import { useMutation } from "@tanstack/react-query";
import { showError, showSuccess } from "@/lib/toast";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(["settings", "common"]);
  const [apiName, setApiName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [maxOutputTokens, setMaxOutputTokens] = useState<string>("");
  const [contextWindow, setContextWindow] = useState<string>("");

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

      if (!params.apiName) throw new Error(t("models.modelIdRequired"));
      if (!params.displayName) throw new Error(t("models.modelNameRequired"));
      if (maxOutputTokens && isNaN(params.maxOutputTokens ?? NaN))
        throw new Error(t("models.invalidMaxOutput"));
      if (contextWindow && isNaN(params.contextWindow ?? NaN))
        throw new Error(t("models.invalidContextWindow"));

      await ipc.languageModel.createCustomModel({
        providerId: params.providerId,
        displayName: params.displayName,
        apiName: params.apiName,
        description: params.description,
        maxOutputTokens: params.maxOutputTokens,
        contextWindow: params.contextWindow,
      });
    },
    onSuccess: () => {
      showSuccess(t("models.modelCreated"));
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
          <DialogTitle>{t("models.addModelTitle")}</DialogTitle>
          <DialogDescription>
            {t("models.addModelDescription")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="model-id" className="text-right">
                {t("models.modelId")}
              </Label>
              <Input
                id="model-id"
                value={apiName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setApiName(e.target.value)
                }
                className="col-span-3"
                placeholder={t("models.modelIdHelp")}
                required
                disabled={mutation.isPending}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="model-name" className="text-right">
                {t("models.modelName")}
              </Label>
              <Input
                id="model-name"
                value={displayName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDisplayName(e.target.value)
                }
                className="col-span-3"
                placeholder={t("models.modelNameHelp")}
                required
                disabled={mutation.isPending}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="description" className="text-right">
                {t("models.modelDescription")}
              </Label>
              <Input
                id="description"
                value={description}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setDescription(e.target.value)
                }
                className="col-span-3"
                placeholder={t("models.modelDescriptionHelp")}
                disabled={mutation.isPending}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="max-output-tokens" className="text-right">
                {t("models.maxOutputTokensLabel")}
              </Label>
              <Input
                id="max-output-tokens"
                type="number"
                value={maxOutputTokens}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setMaxOutputTokens(e.target.value)
                }
                className="col-span-3"
                placeholder={t("models.maxOutputTokensHelp")}
                disabled={mutation.isPending}
              />
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="context-window" className="text-right">
                {t("models.contextWindowLabel")}
              </Label>
              <Input
                id="context-window"
                type="number"
                value={contextWindow}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setContextWindow(e.target.value)
                }
                className="col-span-3"
                placeholder={t("models.contextWindowHelp")}
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
              {t("common:cancel")}
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t("models.adding") : t("models.addModel")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
