import {
  ArrowLeft,
  Circle,
  ExternalLink,
  GiftIcon,
  KeyRound,
  Settings as SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { IpcClient } from "@/ipc/ipc_client";

interface ProviderSettingsHeaderProps {
  providerDisplayName: string;
  isConfigured: boolean;
  isLoading: boolean;
  hasFreeTier?: boolean;
  providerWebsiteUrl?: string;
  isDyad: boolean;
  onBackClick: () => void;
}

function getKeyButtonText({
  isConfigured,
  isDyad,
}: {
  isConfigured: boolean;
  isDyad: boolean;
}) {
  if (isDyad) {
    return isConfigured
      ? "Manage Dyad Pro Subscription"
      : "Setup Dyad Pro Subscription";
  }
  return isConfigured ? "Manage API Keys" : "Setup API Key";
}

export function ProviderSettingsHeader({
  providerDisplayName,
  isConfigured,
  isLoading,
  hasFreeTier,
  providerWebsiteUrl,
  isDyad,
  onBackClick,
}: ProviderSettingsHeaderProps) {
  const handleGetApiKeyClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (providerWebsiteUrl) {
      IpcClient.getInstance().openExternalUrl(providerWebsiteUrl);
    }
  };

  return (
    <>
      <Button
        onClick={onBackClick}
        variant="outline"
        size="sm"
        className="flex items-center gap-2 mb-4 bg-(--background-lightest) py-5"
      >
        <ArrowLeft className="h-4 w-4" />
        Go Back
      </Button>

      <div className="mb-6">
        <div className="flex items-center mb-1">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mr-3">
            Configure {providerDisplayName}
          </h1>
          {isLoading ? (
            <Skeleton className="h-6 w-6 rounded-full" />
          ) : (
            <Circle
              className={`h-5 w-5 ${
                isConfigured
                  ? "fill-green-500 text-green-600"
                  : "fill-yellow-400 text-yellow-500"
              }`}
            />
          )}
          <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">
            {isLoading
              ? "Loading..."
              : isConfigured
                ? "Setup Complete"
                : "Not Setup"}
          </span>
        </div>
        {!isLoading && hasFreeTier && (
          <span className="text-blue-600 mt-2 dark:text-blue-400 text-sm font-medium bg-blue-100 dark:bg-blue-900/30 px-2 py-1 rounded-full inline-flex items-center">
            <GiftIcon className="w-4 h-4 mr-1" />
            Free tier available
          </span>
        )}
      </div>

      {providerWebsiteUrl && !isLoading && (
        <Button
          onClick={handleGetApiKeyClick}
          className="mb-4 cursor-pointer py-5 w-full"
          // variant="primary"
        >
          {isConfigured ? (
            <SettingsIcon className="mr-2 h-4 w-4" />
          ) : (
            <KeyRound className="mr-2 h-4 w-4" />
          )}
          {getKeyButtonText({ isConfigured, isDyad })}
          <ExternalLink className="ml-2 h-4 w-4" />
        </Button>
      )}
    </>
  );
}
