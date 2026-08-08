import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  Cable,
  ChevronRight,
  Edit,
  Plus,
  Trash2,
} from "lucide-react";

import type { LanguageModelProvider } from "@/ipc/types";
import { providerSettingsRoute } from "@/routes/settings/providers/$provider";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";
import { useCustomLanguageModelProvider } from "@/hooks/useCustomLanguageModelProvider";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
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
import { CreateCustomProviderDialog } from "@/components/CreateCustomProviderDialog";
import { useSettings } from "@/hooks/useSettings";
import { useLocalProviderStatus } from "@/hooks/useLocalProviderStatus";
import { cn } from "@/lib/utils";
import { isProviderVisibleInSettings } from "@/lib/settings_provider_visibility";

function modelCountLabel(count: number | undefined) {
  if (count === undefined) return "Loading models…";
  return `${count} ${count === 1 ? "model" : "models"}`;
}

type ProviderRowProps = {
  provider: LanguageModelProvider;
  isReady: boolean;
  modelCount?: number;
  localServerUrl?: string;
  onOpen: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
};

function ProviderRow({
  provider,
  isReady,
  modelCount,
  localServerUrl,
  onOpen,
  onEdit,
  onDelete,
}: ProviderRowProps) {
  const isCustom = provider.type === "custom";
  const isLocal = provider.type === "local";
  const localStatus = useLocalProviderStatus(provider.id, localServerUrl);
  const effectiveReady = isLocal ? localStatus.status === "online" : isReady;
  const effectiveModelCount = isLocal
    ? localStatus.server?.models.length
    : modelCount;
  const effectiveModelCountLabel =
    isLocal && localStatus.status === "offline"
      ? "Unavailable"
      : modelCountLabel(effectiveModelCount);
  const statusLabel = isLocal
    ? {
        checking: "Checking…",
        online: "Online",
        offline: "Offline",
      }[localStatus.status]
    : effectiveReady
      ? "Connected"
      : "Configure to use";
  const statusDotClass = isLocal
    ? {
        checking: "bg-amber-400",
        online: "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]",
        offline: "bg-red-400 shadow-[0_0_8px_rgba(248,113,113,0.5)]",
      }[localStatus.status]
    : effectiveReady
      ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.65)]"
      : "bg-cyan-100/25";

  return (
    <div className="group flex items-center rounded-xl border border-cyan-500/15 bg-[rgba(7,20,38,0.68)] transition-all hover:border-cyan-400/35 hover:bg-cyan-500/6 hover:shadow-[0_0_20px_rgba(0,229,255,0.08)]">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/70"
        onClick={onOpen}
        aria-label={`Configure ${provider.name}`}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-cyan-400/15 bg-cyan-500/8 text-cyan-100">
          <ProviderIcon
            providerId={provider.id}
            className="size-5 [&>svg]:size-5"
          />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-cyan-50/90">
              {provider.name}
            </span>
            {provider.hasFreeTier && (
              <span className="rounded-full border border-cyan-400/20 bg-cyan-500/8 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-200/65">
                Free tier
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-2 text-xs text-cyan-100/40">
            <span
              className={`size-2 rounded-full ${statusDotClass}`}
              aria-hidden
            />
            <span
              className={cn(
                isLocal &&
                  localStatus.status === "offline" &&
                  "text-red-300/80",
              )}
            >
              {statusLabel}
            </span>
            <span aria-hidden>·</span>
            <span>{effectiveModelCountLabel}</span>
          </span>
        </span>

        <span className="hidden shrink-0 text-xs font-medium text-cyan-200/45 transition-colors group-hover:text-cyan-200/75 sm:block">
          {effectiveReady ? "Manage models" : "Set up"}
        </span>
        <ChevronRight className="size-4 shrink-0 text-cyan-200/30 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-200/70" />
      </button>

      {isCustom && (
        <div className="mr-2 flex shrink-0 items-center border-l border-cyan-500/10 pl-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  data-testid="edit-custom-provider"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-cyan-100/45 hover:bg-cyan-500/10 hover:text-cyan-100"
                  onClick={onEdit}
                />
              }
            >
              <Edit className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Edit provider</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  data-testid="delete-custom-provider"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-cyan-100/35 hover:bg-destructive/10 hover:text-destructive"
                  onClick={onDelete}
                />
              }
            >
              <Trash2 className="size-4" />
            </TooltipTrigger>
            <TooltipContent>Delete provider</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

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
  const { data: modelsByProvider } = useLanguageModelsByProviders();
  const { deleteProvider, isDeleting } = useCustomLanguageModelProvider();
  const { settings } = useSettings();

  const handleProviderClick = (providerId: string) => {
    navigate({
      to: providerSettingsRoute.id,
      params: { provider: providerId },
    });
  };

  const handleDeleteProvider = async () => {
    if (!providerToDelete) return;
    await deleteProvider(providerToDelete);
    setProviderToDelete(null);
    refetch();
  };

  const handleEditProvider = (provider: LanguageModelProvider) => {
    setEditingProvider(provider);
    setIsDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="mb-6 h-12 w-64 rounded-lg" />
        {[1, 2, 3, 4, 5].map((item) => (
          <Skeleton key={item} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
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

  const cloudProviders = providers?.filter(
    (provider) =>
      provider.type !== "local" && isProviderVisibleInSettings(provider.id),
  );
  const localProviders = providers?.filter(
    (provider) =>
      provider.type === "local" && isProviderVisibleInSettings(provider.id),
  );

  const renderProvider = (provider: LanguageModelProvider) => (
    <ProviderRow
      key={provider.id}
      provider={provider}
      isReady={isProviderSetup(provider.id)}
      modelCount={modelsByProvider?.[provider.id]?.length}
      localServerUrl={
        (
          settings?.providerSettings?.[provider.id] as
            | { apiBaseUrl?: string }
            | undefined
        )?.apiBaseUrl
      }
      onOpen={() => handleProviderClick(provider.id)}
      onEdit={() => handleEditProvider(provider)}
      onDelete={() => setProviderToDelete(provider.id)}
    />
  );

  return (
    <div className="p-5 sm:p-6">
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-cyan-400/20 bg-cyan-500/10 text-cyan-300 shadow-[0_0_16px_rgba(0,229,255,0.1)]">
            <Cable className="size-5" />
          </span>
          <div>
            <h2 className="font-jarvis-display text-xl font-semibold tracking-wide text-cyan-50">
              Providers
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-cyan-100/45">
              Connect an AI provider, then choose from all of its available
              models.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 border-cyan-400/20 bg-cyan-500/6 text-cyan-100/80 hover:border-cyan-400/40 hover:bg-cyan-500/12 hover:text-cyan-50"
          onClick={() => setIsDialogOpen(true)}
        >
          <Plus className="size-4" />
          Add provider
        </Button>
      </div>

      <p className="mb-2 font-jarvis-ui text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-200/35">
        Cloud providers
      </p>
      <div className="space-y-2">{cloudProviders?.map(renderProvider)}</div>

      {!!localProviders?.length && (
        <section className="mt-6">
          <div className="mb-2 flex items-center justify-between gap-4">
            <p className="font-jarvis-ui text-[10px] font-medium uppercase tracking-[0.18em] text-cyan-200/35">
              Local providers
            </p>
            <span className="text-[11px] text-cyan-100/30">
              Runs on this computer
            </span>
          </div>
          <div className="space-y-2">{localProviders.map(renderProvider)}</div>
        </section>
      )}

      <CreateCustomProviderDialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false);
          setEditingProvider(null);
        }}
        onSuccess={() => {
          setIsDialogOpen(false);
          setEditingProvider(null);
          refetch();
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
