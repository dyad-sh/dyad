import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { DatabaseZap, Trash2 } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { useSettings } from "@/hooks/useSettings";
import { useSupabase } from "@/hooks/useSupabase";
import { showSuccess, showError } from "@/lib/toast";
import { isSupabaseConnected } from "@/lib/schemas";
import { SETTING_IDS } from "@/lib/settingsSearchIndex";

export function SupabaseIntegration() {
  const { t } = useTranslation(["home", "common"]);
  const { settings, updateSettings } = useSettings();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [isSavingOverrides, setIsSavingOverrides] = useState(false);
  const [selfHostedApiUrlInput, setSelfHostedApiUrlInput] = useState("");
  const [selfHostedSecretKeyInput, setSelfHostedSecretKeyInput] = useState("");
  const [overrideError, setOverrideError] = useState("");

  // Check if there are any connected organizations
  const isConnected = isSupabaseConnected(settings);

  const {
    organizations,
    refetchOrganizations,
    deleteOrganization,
    refetchProjects,
  } = useSupabase();

  const savedSelfHostedApiUrl =
    settings?.supabase?.selfHostedSupabaseApiUrl?.trim() ?? "";
  const savedSelfHostedSecretKey =
    settings?.supabase?.selfHostedSupabaseSecretKey?.value?.trim() ?? "";

  useEffect(() => {
    setSelfHostedApiUrlInput(savedSelfHostedApiUrl);
    setSelfHostedSecretKeyInput(savedSelfHostedSecretKey);
    setOverrideError("");
  }, [savedSelfHostedApiUrl, savedSelfHostedSecretKey]);

  const trimmedSelfHostedApiUrl = selfHostedApiUrlInput.trim();
  const trimmedSelfHostedSecretKey = selfHostedSecretKeyInput.trim();
  const hasSelfHostedOverrideInput = Boolean(
    trimmedSelfHostedApiUrl || trimmedSelfHostedSecretKey,
  );
  const hasValidSelfHostedOverridePair = Boolean(
    trimmedSelfHostedApiUrl && trimmedSelfHostedSecretKey,
  );
  const isSelfHostedOverrideDirty =
    trimmedSelfHostedApiUrl !== savedSelfHostedApiUrl ||
    trimmedSelfHostedSecretKey !== savedSelfHostedSecretKey;
  const hasSelfHostedOverridesSaved = Boolean(
    savedSelfHostedApiUrl || savedSelfHostedSecretKey,
  );

  const canSaveSelfHostedOverrides =
    !isSavingOverrides &&
    isSelfHostedOverrideDirty &&
    (!hasSelfHostedOverrideInput || hasValidSelfHostedOverridePair);

  const handleDisconnectAllFromSupabase = async () => {
    setIsDisconnecting(true);
    try {
      const currentSupabase = settings?.supabase ?? {};
      const result = await updateSettings({
        supabase: {
          ...currentSupabase,
          organizations: undefined,
          accessToken: undefined,
          refreshToken: undefined,
          expiresIn: undefined,
          tokenTimestamp: undefined,
        },
        // Also disable the migration setting on disconnect
        enableSupabaseWriteSqlMigration: false,
      });
      if (result) {
        showSuccess(t("integrations.supabase.disconnectedAll"));
        await refetchOrganizations();
        await refetchProjects();
      } else {
        showError(t("integrations.supabase.failedDisconnect"));
      }
    } catch (err: any) {
      showError(
        err.message ||
          t("integrations.supabase.failedDisconnect") ||
          "An error occurred while disconnecting from Supabase",
      );
    } finally {
      setIsDisconnecting(false);
    }
  };

  const saveSelfHostedOverrides = async (apiUrl: string, secretKey: string) => {
    setOverrideError("");
    const trimmedApiUrl = apiUrl.trim();
    const trimmedSecretKey = secretKey.trim();

    if (trimmedApiUrl || trimmedSecretKey) {
      if (!trimmedApiUrl || !trimmedSecretKey) {
        setOverrideError(
          t("integrations.supabase.selfHostedOverridesPairRequired"),
        );
        return;
      }
    }

    setIsSavingOverrides(true);

    try {
      const currentSupabase = settings?.supabase ?? {};
      const result = await updateSettings({
        supabase: {
          ...currentSupabase,
          selfHostedSupabaseApiUrl: trimmedApiUrl || undefined,
          selfHostedSupabaseSecretKey: trimmedSecretKey
            ? {
                value: trimmedSecretKey,
              }
            : undefined,
        },
      });

      if (result) {
        if (trimmedApiUrl) {
          showSuccess(t("integrations.supabase.selfHostedOverridesSaved"));
        } else {
          showSuccess(t("integrations.supabase.selfHostedOverridesCleared"));
        }
      } else {
        showError(t("integrations.supabase.failedDisconnect"));
      }
    } catch (err: any) {
      showError(
        err.message ||
          t("integrations.supabase.selfHostedOverridesPairRequired"),
      );
    } finally {
      setIsSavingOverrides(false);
    }
  };

  const handleSaveSelfHostedOverrides = async () => {
    if (!isSelfHostedOverrideDirty) {
      return;
    }

    if (hasSelfHostedOverrideInput && !hasValidSelfHostedOverridePair) {
      setOverrideError(
        t("integrations.supabase.selfHostedOverridesPairRequired"),
      );
      return;
    }

    await saveSelfHostedOverrides(
      trimmedSelfHostedApiUrl,
      trimmedSelfHostedSecretKey,
    );
  };

  const handleClearSelfHostedOverrides = async () => {
    if (!hasSelfHostedOverridesSaved || isSavingOverrides) {
      return;
    }

    setSelfHostedApiUrlInput("");
    setSelfHostedSecretKeyInput("");
    await saveSelfHostedOverrides("", "");
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
          disabled={!isConnected || isDisconnecting}
          className="flex items-center gap-2"
        >
          {isDisconnecting
            ? t("common:disconnecting")
            : t("integrations.supabase.disconnectAll")}
          <DatabaseZap className="h-4 w-4" />
        </Button>
      </div>

      <div id={SETTING_IDS.supabaseSelfHostedApiUrl} className="mt-4 space-y-1">
        <Label htmlFor="supabase-self-hosted-api-url">
          {t("integrations.supabase.selfHostedApiUrl")}
        </Label>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t("integrations.supabase.selfHostedOverridesDescription")}
        </p>
        <Input
          id="supabase-self-hosted-api-url"
          value={selfHostedApiUrlInput}
          onChange={(e) => {
            setSelfHostedApiUrlInput(e.target.value);
            setOverrideError("");
          }}
          placeholder={t("integrations.supabase.selfHostedApiUrlPlaceholder")}
          className="max-w-lg"
        />
      </div>

      <div
        id={SETTING_IDS.supabaseSelfHostedSecretKey}
        className="mt-3 space-y-1"
      >
        <Label htmlFor="supabase-self-hosted-secret-key">
          {t("integrations.supabase.selfHostedSecretKey")}
        </Label>
        <Input
          id="supabase-self-hosted-secret-key"
          value={selfHostedSecretKeyInput}
          onChange={(e) => {
            setSelfHostedSecretKeyInput(e.target.value);
            setOverrideError("");
          }}
          placeholder={t(
            "integrations.supabase.selfHostedSecretKeyPlaceholder",
          )}
          className="max-w-lg"
          type="password"
        />

        {(overrideError ||
          (hasSelfHostedOverrideInput && !hasValidSelfHostedOverridePair)) && (
          <p className="text-xs text-red-600 dark:text-red-400">
            {overrideError ||
              t("integrations.supabase.selfHostedOverridesPairRequired")}
          </p>
        )}

        <div className="flex items-center gap-2">
          <Button
            onClick={handleSaveSelfHostedOverrides}
            size="sm"
            disabled={!canSaveSelfHostedOverrides}
          >
            {isSavingOverrides
              ? t("common:saving")
              : t("integrations.supabase.selfHostedOverridesSave")}
          </Button>
          <Button
            onClick={handleClearSelfHostedOverrides}
            variant="outline"
            size="sm"
            disabled={!hasSelfHostedOverridesSaved || isSavingOverrides}
          >
            {t("integrations.supabase.selfHostedOverridesClear")}
          </Button>
        </div>
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
