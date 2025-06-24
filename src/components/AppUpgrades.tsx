import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import { IpcClient } from "@/ipc/ipc_client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppUpgrade } from "@/ipc/ipc_types";

export function AppUpgrades({ appId }: { appId: number | null }) {
  const queryClient = useQueryClient();

  const {
    data: upgrades,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: ["app-upgrades", appId],
    queryFn: () => {
      if (!appId) {
        return Promise.resolve([]);
      }
      return IpcClient.getInstance().getAppUpgrades({ appId });
    },
    enabled: !!appId,
  });

  const {
    mutate: executeUpgrade,
    isPending: isUpgrading,
    error: mutationError,
    variables: upgradingVariables,
  } = useMutation({
    mutationFn: (upgradeId: string) => {
      if (!appId) {
        throw new Error("appId is not set");
      }
      return IpcClient.getInstance().executeAppUpgrade({
        appId,
        upgradeId,
      });
    },
    onSuccess: (_, upgradeId) => {
      queryClient.invalidateQueries({ queryKey: ["app-upgrades", appId] });
      if (upgradeId === "capacitor") {
        // Capacitor upgrade is done, so we need to invalidate the Capacitor
        // query to show the new status.
        queryClient.invalidateQueries({ queryKey: ["is-capacitor", appId] });
      }
    },
  });

  const handleUpgrade = (upgradeId: string) => {
    executeUpgrade(upgradeId);
  };

  if (!appId) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
          App Upgrades
        </h3>
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
          App Upgrades
        </h3>
        <Alert variant="destructive">
          <AlertTitle>Error loading upgrades</AlertTitle>
          <AlertDescription>{queryError.message}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const currentUpgrades = upgrades?.filter((u) => u.isNeeded) ?? [];

  return (
    <div className="mt-6">
      <h3 className="text-lg font-semibold mb-3 text-gray-900 dark:text-gray-100">
        App Upgrades
      </h3>
      {currentUpgrades.length === 0 ? (
        <div
          data-testid="no-app-upgrades-needed"
          className="p-4 bg-green-50 border border-green-200 dark:bg-green-900/20 dark:border-green-800/50 rounded-lg text-sm text-green-800 dark:text-green-300"
        >
          App is up-to-date and has all Dyad capabilities enabled
        </div>
      ) : (
        <div className="space-y-4">
          {currentUpgrades.map((upgrade: AppUpgrade) => (
            <div
              key={upgrade.id}
              className="p-4 border border-gray-200 dark:border-gray-700 rounded-lg flex justify-between items-start"
            >
              <div className="flex-grow">
                <h4 className="font-semibold text-gray-800 dark:text-gray-200">
                  {upgrade.title}
                </h4>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {upgrade.description}
                </p>
                {mutationError && upgradingVariables === upgrade.id && (
                  <Alert
                    variant="destructive"
                    className="mt-3 dark:bg-destructive/15"
                  >
                    <Terminal className="h-4 w-4" />
                    <AlertTitle className="dark:text-red-200">
                      Upgrade Failed
                    </AlertTitle>
                    <AlertDescription className="text-xs text-red-400 dark:text-red-300">
                      {(mutationError as Error).message}{" "}
                      <a
                        onClick={(e) => {
                          e.stopPropagation();
                          IpcClient.getInstance().openExternalUrl(
                            upgrade.manualUpgradeUrl ?? "https://dyad.sh/docs",
                          );
                        }}
                        className="underline font-medium hover:dark:text-red-200"
                      >
                        Manual Upgrade Instructions
                      </a>
                    </AlertDescription>
                  </Alert>
                )}
              </div>
              <Button
                onClick={() => handleUpgrade(upgrade.id)}
                disabled={isUpgrading && upgradingVariables === upgrade.id}
                className="ml-4 flex-shrink-0"
                size="sm"
                data-testid={`app-upgrade-${upgrade.id}`}
              >
                {isUpgrading && upgradingVariables === upgrade.id ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Upgrade
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
