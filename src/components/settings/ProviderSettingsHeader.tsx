import {
  ArrowLeft,
  ArrowUp,
  Circle,
  ExternalLink,
  GiftIcon,
  KeyRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ipc } from "@/ipc/types";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { LocalProviderConnectionStatus } from "@/hooks/useLocalProviderStatus";

interface ProviderSettingsHeaderProps {
  providerDisplayName: string;
  isConfigured: boolean;
  isLoading: boolean;
  hasFreeTier?: boolean;
  providerWebsiteUrl?: string;
  isMetaHumanOS: boolean;
  isLocalProvider?: boolean;
  localConnectionStatus?: LocalProviderConnectionStatus;
  onBackClick: () => void;
}

function getKeyButtonText({
  isConfigured,
  isMetaHumanOS,
}: {
  isConfigured: boolean;
  isMetaHumanOS: boolean;
}) {
  if (isMetaHumanOS) {
    return isConfigured ? "Manage Pro Subscription" : "Setup Pro Subscription";
  }
  return isConfigured ? "Manage API Keys" : "Setup API Key";
}

export function ProviderSettingsHeader({
  providerDisplayName,
  isConfigured,
  isLoading,
  hasFreeTier,
  providerWebsiteUrl,
  isMetaHumanOS,
  isLocalProvider = false,
  localConnectionStatus,
  onBackClick,
}: ProviderSettingsHeaderProps) {
  const handleGetApiKeyClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (providerWebsiteUrl) {
      ipc.system.openExternalUrl(providerWebsiteUrl);
    }
  };

  const configureButton = (
    <Button
      onClick={handleGetApiKeyClick}
      size="default"
      className={cn(
        "h-10 w-fit shrink-0 gap-2 px-5 font-medium shadow-sm",
        "ring-1 ring-primary/30",
        !isConfigured && "shadow-[0_0_20px_rgba(0,229,255,0.15)]",
      )}
    >
      <KeyRound className="size-4" />
      {getKeyButtonText({ isConfigured, isMetaHumanOS })}
      <ExternalLink className="size-3.5 opacity-70" />
    </Button>
  );
  const localStatus =
    isLocalProvider && localConnectionStatus
      ? {
          checking: {
            label: "Checking",
            className: "border-amber-500/40 bg-amber-500/10 text-amber-400",
            dotClassName: "text-amber-400",
          },
          online: {
            label: "Online",
            className:
              "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
            dotClassName: "text-emerald-400",
          },
          offline: {
            label: "Offline",
            className: "border-red-500/40 bg-red-500/10 text-red-400",
            dotClassName: "text-red-400",
          },
        }[localConnectionStatus]
      : null;

  return (
    <header className="mb-8 space-y-5">
      <Button
        onClick={onBackClick}
        variant="ghost"
        size="sm"
        className="-ml-2 gap-2 text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Go Back
      </Button>

      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary/80">
              Provider
            </p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {providerDisplayName}
              </h1>
              {isLoading ? (
                <Skeleton className="h-6 w-20 rounded-full" />
              ) : (
                <Badge
                  variant="outline"
                  className={cn(
                    "gap-1.5 border px-2.5 py-0.5 font-normal",
                    localStatus
                      ? localStatus.className
                      : isConfigured
                        ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
                  )}
                >
                  <Circle
                    className={cn(
                      "size-2 fill-current",
                      localStatus
                        ? localStatus.dotClassName
                        : isConfigured
                          ? "text-emerald-500"
                          : "text-amber-500",
                    )}
                  />
                  {localStatus
                    ? localStatus.label
                    : isConfigured
                      ? "Configured"
                      : "Not configured"}
                </Badge>
              )}
            </div>
            {!isLoading && hasFreeTier && (
              <Badge
                variant="secondary"
                className="gap-1 border border-primary/20 bg-primary/10 text-primary"
              >
                <GiftIcon className="size-3.5" />
                Free tier available
              </Badge>
            )}
          </div>

          {providerWebsiteUrl && !isLoading && !isLocalProvider && (
            <div className="flex shrink-0 items-start">
              {!isConfigured ? (
                <Popover defaultOpen>
                  <PopoverTrigger render={configureButton} />
                  <PopoverContent
                    side="bottom"
                    align="end"
                    className="w-fit border-primary/20 bg-card px-3 py-2 shadow-lg"
                  >
                    <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <ArrowUp className="size-3.5 text-primary" />
                      Create your API key on {providerDisplayName}
                    </p>
                  </PopoverContent>
                </Popover>
              ) : (
                configureButton
              )}
            </div>
          )}
        </div>

        <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
          {isLocalProvider
            ? `Point Meta Human OS at your ${providerDisplayName} server. Models are loaded from the local API — no cloud API key required.`
            : `Connect your ${providerDisplayName} account to enable models in Meta Human OS. Keys saved here take priority over environment variables.`}
        </p>
      </div>
    </header>
  );
}
