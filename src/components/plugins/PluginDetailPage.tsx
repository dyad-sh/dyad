import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DeleteConfirmationDialog } from "@/components/DeleteConfirmationDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useMcp } from "@/hooks/useMcp";
import { useMcpCatalog } from "@/hooks/useMcpCatalog";
import { useLoadApps } from "@/hooks/useLoadApps";
import { CatalogBadge } from "./CatalogBadge";
import { PluginIcon } from "./PluginIcon";
import {
  PluginConnectionPanel,
  PluginOAuthBadge,
  PluginOAuthButtons,
} from "./PluginConnectionPanel";
import { PluginDefaultAvailability } from "./PluginDefaultAvailability";
import { PluginAppConfigsSection } from "./PluginAppConfigsSection";
import { connectionSetupState } from "./pluginSetup";

export function PluginDetailPage({ serverId }: { serverId: number }) {
  const navigate = useNavigate();
  const {
    servers,
    appConfigs,
    appScopedPluginsEnabled,
    isServersLoading,
    toggleEnabled,
    deleteServer,
  } = useMcp();
  const { apps } = useLoadApps();

  // The server's catalog entry supplies the declared setup fields. It's a
  // cached read that returns nothing for manually-added servers.
  const catalogQuery = useMcpCatalog();

  const s = servers.find((srv) => srv.id === serverId);

  // Unknown id (deleted elsewhere, bad deep link) lands back on the
  // plugins list once the server query has resolved. Gated on the
  // servers query alone: it is a fast local read, while tool
  // discovery can take seconds and has no bearing on whether the
  // server exists.
  useEffect(() => {
    if (!isServersLoading && !s) {
      navigate({ to: "/plugins" });
    }
  }, [isServersLoading, s, navigate]);

  if (!s) {
    // A deep link or refresh reaches here before the servers query
    // resolves; mirror the page layout instead of flashing blank.
    if (isServersLoading) {
      return (
        <div className="w-full min-h-screen px-8 py-4">
          <div className="max-w-5xl pb-12">
            <Skeleton className="h-8 w-28 mb-4" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        </div>
      );
    }
    // Unknown id; the effect above is navigating back to the list.
    return null;
  }

  const catalogEntry = s.catalogSlug
    ? catalogQuery.data?.entries.find((e) => e.slug === s.catalogSlug)
    : undefined;
  const { setupIncomplete } = connectionSetupState(
    s,
    catalogEntry,
    catalogQuery.isLoading,
  );
  const pluginAppConfigs = appConfigs.filter(
    (config) => config.serverId === s.id,
  );
  const pickableApps = apps.map((app) => ({ id: app.id, name: app.name }));

  const onDelete = async () => {
    await deleteServer(s.id);
    navigate({ to: "/plugins" });
  };

  return (
    <div className="w-full min-h-screen px-8 py-4" data-testid="plugin-detail">
      <div className="max-w-5xl pb-12">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4"
          onClick={() => navigate({ to: "/plugins" })}
        >
          <ArrowLeft size={16} />
          All Plugins
        </Button>

        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6">
          {s.oauthUnreadable && (
            <Alert variant="destructive" className="mb-3">
              <AlertTitle>Saved OAuth credentials can't be read</AlertTitle>
              <AlertDescription>
                Unlock or restore your OS keyring and reopen this page to retry.
                To sign in again, Reset OAuth removes the saved OAuth
                credentials.
              </AlertDescription>
            </Alert>
          )}
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <PluginIcon
                name={s.name}
                iconUrl={catalogEntry?.iconUrl}
                size="md"
              />
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
                  <span className="truncate">{s.name}</span>
                  {s.catalogSlug && <CatalogBadge size="md" />}
                  <PluginOAuthBadge connection={s} />
                </h1>
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  {s.transport}
                  {s.url ? ` · ${s.url}` : ""}
                  {s.command ? ` · ${s.command}` : ""}
                  {Array.isArray(s.args) && s.args.length
                    ? ` · ${s.args.join(" ")}`
                    : ""}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <PluginOAuthButtons
                connection={s}
                setupIncomplete={setupIncomplete}
              />
              <Switch
                aria-label={`Enabled toggle for ${s.name}`}
                checked={!!s.enabled}
                disabled={setupIncomplete}
                onCheckedChange={() => toggleEnabled(s.id, !!s.enabled)}
              />
              <DeleteConfirmationDialog
                itemName={s.name}
                itemType="Plugin"
                onDelete={onDelete}
                details={
                  pluginAppConfigs.length > 0
                    ? `This also deletes its ${pluginAppConfigs.length} app-specific configuration${
                        pluginAppConfigs.length === 1 ? "" : "s"
                      }.`
                    : undefined
                }
                trigger={
                  <span className={buttonVariants({ variant: "outline" })}>
                    Delete
                  </span>
                }
              />
            </div>
          </div>

          {appScopedPluginsEnabled && (
            <div className="mt-6 border-t pt-4">
              <h2 className="text-lg font-semibold">Default configuration</h2>
              <PluginDefaultAvailability
                server={s}
                appConfigs={pluginAppConfigs}
                apps={pickableApps}
              />
            </div>
          )}

          <PluginConnectionPanel
            connection={s}
            catalogEntry={catalogEntry}
            catalogIsLoading={catalogQuery.isLoading}
          />
        </div>

        {appScopedPluginsEnabled && (
          <PluginAppConfigsSection
            server={s}
            appConfigs={pluginAppConfigs}
            apps={pickableApps}
            catalogEntry={catalogEntry}
            catalogIsLoading={catalogQuery.isLoading}
          />
        )}
      </div>
    </div>
  );
}
