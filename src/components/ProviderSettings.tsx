import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useNavigate } from "@tanstack/react-router";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";
import type { LanguageModelProvider } from "@/ipc/types";

import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useCustomLanguageModelProvider } from "@/hooks/useCustomLanguageModelProvider";
import { GiftIcon, PlusIcon, Trash2, Edit } from "lucide-react";
import { Skeleton } from "./ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { CreateCustomProviderDialog } from "./CreateCustomProviderDialog";

export function ProviderSettingsGrid() {
  const navigate = useNavigate();
  const { t } = useTranslation(["settings", "common"]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingProvider, setEditingProvider] =
    useState<LanguageModelProvider | null>(null);
  const [providerToDelete, setProviderToDelete] = useState<string | null>(null);

  const {
    data: providers,
    isLoading,
    error,
    isProviderSetup,
    refetch,
  } = useLanguageModelProviders();

  const { deleteProvider, isDeleting } = useCustomLanguageModelProvider();

  const handleProviderClick = (providerId: string) => {
    navigate({
      to: providerSettingsRoute.id,
      params: { provider: providerId },
    });
  };

  const handleDeleteProvider = async () => {
    if (providerToDelete) {
      await deleteProvider(providerToDelete);
      setProviderToDelete(null);
      refetch();
    }
  };

  const handleEditProvider = (provider: LanguageModelProvider) => {
    setEditingProvider(provider);
    setIsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3, 4, 5].map((i) => (
          <Card key={i} className="border-border shadow-none">
            <CardHeader className="p-4">
              <Skeleton className="h-6 w-3/4 mb-2" />
              <Skeleton className="h-4 w-1/2" />
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("common:error")}</AlertTitle>
          <AlertDescription>
            {t("settings:ai.failedToLoadProviders", { message: error.message })}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {providers
          ?.filter((p) => p.type !== "local")
          .map((provider: LanguageModelProvider) => {
            const isCustom = provider.type === "custom";

            return (
              <Card
                key={provider.id}
                className="relative border-border shadow-none transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <CardHeader
                  className="p-4 cursor-pointer"
                  onClick={() => handleProviderClick(provider.id)}
                >
                  {isCustom && (
                    <div
                      className="flex items-center justify-end"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              data-testid="edit-custom-provider"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 hover:bg-muted rounded-md"
                              onClick={() => handleEditProvider(provider)}
                            />
                          }
                        >
                          <Edit className="h-4 w-4" />
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("settings:ai.editProvider")}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              data-testid="delete-custom-provider"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10 rounded-md"
                              onClick={() => setProviderToDelete(provider.id)}
                            />
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("settings:ai.deleteProvider")}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  )}
                  <CardTitle className="text-lg font-medium mb-2">
                    {provider.name}
                    {isProviderSetup(provider.id) ? (
                      <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        {t("common:ready")}
                      </span>
                    ) : (
                      <span className="ml-2 rounded-full border border-border/70 bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {t("common:needsSetup")}
                      </span>
                    )}
                  </CardTitle>
                  <CardDescription>
                    {provider.hasFreeTier && (
                      <span className="mt-2 inline-flex items-center rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-400">
                        <GiftIcon className="mr-1 h-3.5 w-3.5" />
                        {t("settings:ai.freeTierAvailable")}
                      </span>
                    )}
                  </CardDescription>
                </CardHeader>
              </Card>
            );
          })}

        {/* Add custom provider button */}
        <Card
          className="cursor-pointer border-border border-dashed shadow-none transition-colors hover:border-primary/70 hover:bg-muted/30"
          onClick={() => setIsDialogOpen(true)}
        >
          <CardHeader className="p-4 flex flex-col items-center justify-center h-full">
            <PlusIcon className="h-8 w-8 text-muted-foreground mb-2" />
            <CardTitle className="text-lg font-medium text-center">
              {t("settings:ai.addCustomProvider")}
            </CardTitle>
            <CardDescription className="text-center">
              {t("settings:ai.connectCustomEndpoint")}
            </CardDescription>
          </CardHeader>
        </Card>
      </div>

      <CreateCustomProviderDialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false);
          setEditingProvider(null);
        }}
        onSuccess={() => {
          setIsDialogOpen(false);
          refetch();
          setEditingProvider(null);
        }}
        editingProvider={editingProvider}
      />

      <AlertDialog
        open={!!providerToDelete}
        onOpenChange={(open) => !open && setProviderToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("settings:ai.deleteCustomProvider")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings:ai.deleteProviderConfirmation")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>
              {t("common:cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProvider}
              disabled={isDeleting}
            >
              {isDeleting
                ? t("common:deleting")
                : t("settings:ai.deleteProviderAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
