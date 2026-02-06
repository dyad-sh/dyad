import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
// We might need a Supabase icon here, but for now, let's use a generic one or text.
// import { Supabase } from "lucide-react"; // Placeholder
import { DatabaseZap, Trash2 } from "lucide-react"; // Using DatabaseZap as a placeholder
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/useSettings";
import { useSupabase } from "@/hooks/useSupabase";
import { showSuccess, showError } from "@/lib/toast";
import { isSupabaseConnected } from "@/lib/schemas";

export function SupabaseIntegration() {
  const { t } = useTranslation(["home", "common"]);
  const { settings, updateSettings } = useSettings();
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  // Check if there are any connected organizations
  const isConnected = isSupabaseConnected(settings);

  const { organizations, refetchOrganizations, deleteOrganization } =
    useSupabase();

  const handleDisconnectAllFromSupabase = async () => {
    setIsDisconnecting(true);
    try {
      // Clear the entire supabase object in settings (including all organizations)
      const result = await updateSettings({
        supabase: undefined,
        // Also disable the migration setting on disconnect
        enableSupabaseWriteSqlMigration: false,
      });
      if (result) {
        showSuccess(t("integrations.supabase.disconnectedAll"));
        await refetchOrganizations();
      } else {
        showError(t("integrations.supabase.failedDisconnect"));
      }
    } catch (err: any) {
      showError(
        err.message || "An error occurred while disconnecting from Supabase",
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  const handleDeleteOrganization = async (organizationSlug: string) => {
    try {
      await deleteOrganization({ organizationSlug });
      showSuccess(t("integrations.supabase.orgDisconnected"));
    } catch (err: any) {
      showError(err.message || t("integrations.supabase.failedDisconnect"));
    }
  };

  const handleMigrationSettingChange = async (enabled: boolean) => {
    try {
      await updateSettings({
        enableSupabaseWriteSqlMigration: enabled,
      });
      showSuccess(t("integrations.supabase.settingUpdated"));
    } catch (err: any) {
      showError(err.message || "Failed to update setting");
    }
  };

  const handleSkipPruneSettingChange = async (enabled: boolean) => {
    try {
      await updateSettings({
        skipPruneEdgeFunctions: enabled,
      });
      showSuccess("Setting updated");
    } catch (err: any) {
      showError(err.message || "Failed to update setting");
    }
  };

  if (!isConnected) {
    return null;
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("integrations.supabase.title")}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {t("integrations.supabase.organizationsConnected", {
              count: organizations.length,
            })}
          </p>
        </div>
        <Button
          onClick={handleDisconnectAllFromSupabase}
          variant="destructive"
          size="sm"
          disabled={isDisconnecting}
          className="flex items-center gap-2"
        >
          {isDisconnecting
            ? t("common:disconnecting")
            : t("integrations.supabase.disconnectAll")}
          <DatabaseZap className="h-4 w-4" />
        </Button>
      </div>

      {/* Connected organizations list */}
      <div className="mt-3 space-y-1">
        {organizations.map((org) => (
          <div
            key={org.organizationSlug}
            className="flex items-center justify-between p-2 rounded-md bg-muted/50 text-sm gap-2"
          >
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-gray-700 dark:text-gray-300 font-medium truncate">
                {org.name || `Organization ${org.organizationSlug.slice(0, 8)}`}
              </span>
              {org.ownerEmail && (
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {org.ownerEmail}
                </span>
              )}
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() =>
                      handleDeleteOrganization(org.organizationSlug)
                    }
                  />
                }
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                <span className="text-xs">Disconnect</span>
              </TooltipTrigger>
              <TooltipContent>
                {t("integrations.supabase.disconnectOrganization")}
              </TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>

      <div className="mt-4">
        <div className="flex items-center space-x-3">
          <Switch
            id="supabase-migrations"
            aria-label="Write SQL migration files"
            checked={!!settings?.enableSupabaseWriteSqlMigration}
            onCheckedChange={handleMigrationSettingChange}
          />
          <div className="space-y-1">
            <Label
              htmlFor="supabase-migrations"
              className="text-sm font-medium"
            >
              {t("integrations.supabase.writeSqlMigrations")}
            </Label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t("integrations.supabase.writeSqlDescription")}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center space-x-3">
          <Switch
            id="skip-prune-edge-functions"
            aria-label="Keep extra Supabase edge functions"
            checked={!!settings?.skipPruneEdgeFunctions}
            onCheckedChange={handleSkipPruneSettingChange}
          />
          <div className="space-y-1">
            <Label
              htmlFor="skip-prune-edge-functions"
              className="text-sm font-medium"
            >
              Keep extra Supabase edge functions
            </Label>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              When disabled, edge functions deployed to Supabase but not present
              in your codebase will be automatically deleted during sync
              operations (e.g., after reverting or modifying shared modules).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
