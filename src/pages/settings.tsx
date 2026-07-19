import { useEffect, useState } from "react";
import { useTheme } from "../contexts/ThemeContext";
import { ProviderSettingsGrid } from "@/components/ProviderSettings";
import ConfirmationDialog from "@/components/ConfirmationDialog";
import { ipc } from "@/ipc/types";
import { showSuccess, showError } from "@/lib/toast";
import { AutoApproveSwitch } from "@/components/AutoApproveSwitch";
import { TelemetrySwitch } from "@/components/TelemetrySwitch";
import { MaxChatTurnsSelector } from "@/components/MaxChatTurnsSelector";
import { MaxToolCallStepsSelector } from "@/components/MaxToolCallStepsSelector";
import { ThinkingBudgetSelector } from "@/components/ThinkingBudgetSelector";
import { useSettings } from "@/hooks/useSettings";
import { useAppVersion } from "@/hooks/useAppVersion";
import { BackButton } from "@/components/ui/back-button";
import { GitHubIntegration } from "@/components/GitHubIntegration";
import { VercelIntegration } from "@/components/VercelIntegration";
import { SupabaseIntegration } from "@/components/SupabaseIntegration";
import { CustomAppsFolderSelector } from "@/components/CustomAppsFolderSelector";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AutoFixProblemsSwitch } from "@/components/AutoFixProblemsSwitch";
import { AppBlueprintSwitch } from "@/components/AppBlueprintSwitch";
import { AutoExpandPreviewSwitch } from "@/components/AutoExpandPreviewSwitch";
import { KeepPreviewsRunningSwitch } from "@/components/KeepPreviewsRunningSwitch";
import { ChatEventNotificationSwitch } from "@/components/ChatEventNotificationSwitch";
import { AutoUpdateSwitch } from "@/components/AutoUpdateSwitch";
import { ReleaseChannelSelector } from "@/components/ReleaseChannelSelector";
import { NeonIntegration } from "@/components/NeonIntegration";
import { RuntimeModeSelector } from "@/components/RuntimeModeSelector";
import { NodePathSelector } from "@/components/NodePathSelector";
import { AgentToolsSettings } from "@/components/settings/AgentToolsSettings";
import { ZoomSelector } from "@/components/ZoomSelector";
import { LanguageSelector } from "@/components/LanguageSelector";
import { DefaultChatModeSelector } from "@/components/DefaultChatModeSelector";
import { ContextCompactionSwitch } from "@/components/ContextCompactionSwitch";
import { BlockUnsafeNpmPackagesSwitch } from "@/components/BlockUnsafeNpmPackagesSwitch";
import { CloudSandboxExperimentSwitch } from "@/components/CloudSandboxExperimentSwitch";
import { AutoApproveSqlSwitch } from "@/components/AutoApproveSqlSwitch";
import { AutoApproveMcpSwitch } from "@/components/AutoApproveMcpSwitch";
import { useSetAtom } from "jotai";
import { activeSettingsSectionAtom } from "@/atoms/viewAtoms";
import { SECTION_IDS, SETTING_IDS } from "@/lib/settingsSearchIndex";
import { useTranslation } from "react-i18next";

export default function SettingsPage() {
  const { t } = useTranslation(["settings", "common"]);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const appVersion = useAppVersion();
  const { settings, updateSettings } = useSettings();
  const setActiveSettingsSection = useSetAtom(activeSettingsSectionAtom);

  useEffect(() => {
    setActiveSettingsSection(SECTION_IDS.general);
  }, [setActiveSettingsSection]);

  const handleResetEverything = async () => {
    setIsResetting(true);
    try {
      await ipc.system.resetAll();
      showSuccess(t("dangerZone.resetSuccess"));
    } catch (error) {
      console.error("Error resetting:", error);
      showError(
        error instanceof Error ? error.message : t("page.unknownError"),
      );
    } finally {
      setIsResetting(false);
      setIsResetDialogOpen(false);
    }
  };

  return (
    <div className="min-h-screen px-8 py-4">
      <div className="max-w-5xl mx-auto">
        <BackButton />
        <div className="flex justify-between mb-4">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            {t("title")}
          </h1>
        </div>

        <div className="space-y-6">
          <GeneralSettings appVersion={appVersion} />
          <WorkflowSettings />
          <AISettings />

          <div
            id={SECTION_IDS.providers}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-sm"
          >
            <ProviderSettingsGrid />
          </div>

          <div className="space-y-6">
            <div
              id={SECTION_IDS.telemetry}
              className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6"
            >
              <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
                {t("telemetry.title")}
              </h2>
              <div id={SETTING_IDS.telemetry} className="space-y-2">
                <TelemetrySwitch />
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t("telemetry.description")}
                </div>
              </div>

              <div className="mt-2 flex items-center text-sm text-gray-500 dark:text-gray-400">
                <span className="mr-2 font-medium">
                  {t("telemetry.telemetryId")}
                </span>
                <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-800 dark:text-gray-200 font-mono">
                  {settings ? settings.telemetryUserId : "n/a"}
                </span>
              </div>
            </div>
          </div>

          {/* Integrations Section */}
          <div
            id={SECTION_IDS.integrations}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6"
          >
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              {t("integrations.title")}
            </h2>
            <div className="space-y-4">
              <div id={SETTING_IDS.github}>
                <GitHubIntegration />
              </div>
              <div id={SETTING_IDS.vercel}>
                <VercelIntegration />
              </div>
              <div id={SETTING_IDS.supabase}>
                <SupabaseIntegration />
              </div>
              <div id={SETTING_IDS.neon}>
                <NeonIntegration />
              </div>
            </div>
          </div>

          {/* Agent v2 Permissions */}

          <div
            id={SECTION_IDS.agentPermissions}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6"
          >
            <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
              {t("agentPermissions.title")}
            </h2>
            <AgentToolsSettings />
          </div>

          {/* Advanced Section */}
          <div
            id={SECTION_IDS.advanced}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6"
          >
            <div className="mb-6">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                {t("common:advanced")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-2">
                {t("page.advancedDescription")}
              </p>
            </div>
            <div className="space-y-4">
              <div
                id={SETTING_IDS.enableSandboxScriptExecution}
                className="space-y-1 mt-4"
              >
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enable-sandbox-script-execution"
                    aria-label={t("page.enableSandboxScriptExecution")}
                    checked={!!settings?.enableSandboxScriptExecution}
                    onCheckedChange={(checked) => {
                      updateSettings({
                        enableSandboxScriptExecution: checked,
                      });
                    }}
                  />
                  <Label htmlFor="enable-sandbox-script-execution">
                    {t("page.enableSandboxScriptExecution")}
                  </Label>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t("page.sandboxScriptDescription")}
                </div>
              </div>
              <div
                id={SETTING_IDS.blockUnsafeNpmPackages}
                className="space-y-1 mt-4"
              >
                <BlockUnsafeNpmPackagesSwitch />
              </div>
              <div
                id={SETTING_IDS.autoApproveNonSchemaSql}
                className="space-y-1 mt-4"
              >
                <AutoApproveSqlSwitch />
              </div>
            </div>
          </div>

          {/* Experiments Section */}
          <div
            id={SECTION_IDS.experiments}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6"
          >
            <div className="mb-6">
              <h2 className="text-lg font-medium text-gray-900 dark:text-white">
                {t("experiments.title")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1 mb-2">
                {t("page.experimentsDescription")}
              </p>
            </div>
            <div className="space-y-4">
              <div id={SETTING_IDS.enableCloudSandbox} className="space-y-1">
                <CloudSandboxExperimentSwitch />
              </div>
              <div
                id={SETTING_IDS.autoApproveSafeMcpTools}
                className="space-y-1 mt-4"
              >
                <AutoApproveMcpSwitch />
              </div>
              <div
                id={SETTING_IDS.enableMcpToolSearch}
                className="space-y-1 mt-4"
              >
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enable-mcp-tool-search"
                    aria-label={t("page.enableMcpToolSearch")}
                    disabled={!settings?.enableSandboxScriptExecution}
                    checked={
                      !!settings?.enableMcpToolSearch &&
                      !!settings?.enableSandboxScriptExecution
                    }
                    onCheckedChange={(checked) => {
                      updateSettings({
                        enableMcpToolSearch: checked,
                      });
                    }}
                  />
                  <Label htmlFor="enable-mcp-tool-search">
                    {t("page.enableMcpToolSearch")}
                  </Label>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t("page.mcpToolSearchDescription")}
                </div>
                {!settings?.enableSandboxScriptExecution && (
                  <div className="text-xs text-amber-500">
                    {t("page.mcpToolSearchDisabled")}
                  </div>
                )}
              </div>
              <div
                id={SETTING_IDS.enablePnpmMinimumReleaseAgeWarning}
                className="space-y-1 mt-4"
              >
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enable-pnpm-minimum-release-age-warning"
                    aria-label={t("page.enablePnpmWarning")}
                    checked={!!settings?.enablePnpmMinimumReleaseAgeWarning}
                    onCheckedChange={(checked) => {
                      updateSettings({
                        enablePnpmMinimumReleaseAgeWarning: checked,
                      });
                    }}
                  />
                  <Label htmlFor="enable-pnpm-minimum-release-age-warning">
                    {t("page.enablePnpmWarning")}
                  </Label>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t("page.pnpmWarningDescription")}
                </div>
              </div>
              <div
                id={SETTING_IDS.enableSelectAppFromHomeChatInput}
                className="space-y-1 mt-4"
              >
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enable-select-app-from-home-chat-input"
                    aria-label={t("page.enableSelectApp")}
                    checked={!!settings?.enableSelectAppFromHomeChatInput}
                    onCheckedChange={(checked) => {
                      updateSettings({
                        enableSelectAppFromHomeChatInput: checked,
                      });
                    }}
                  />
                  <Label htmlFor="enable-select-app-from-home-chat-input">
                    {t("page.enableSelectApp")}
                  </Label>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t("page.selectAppDescription")}
                </div>
              </div>
              <div
                id={SETTING_IDS.enableCodeExplorer}
                className="space-y-1 mt-4"
              >
                <div className="flex items-center space-x-2">
                  <Switch
                    id="enable-code-explorer"
                    aria-label={t("page.enableCodeExplorer")}
                    checked={!!settings?.enableCodeExplorer}
                    onCheckedChange={(checked) => {
                      updateSettings({
                        enableCodeExplorer: checked,
                      });
                    }}
                  />
                  <Label htmlFor="enable-code-explorer">
                    {t("page.enableCodeExplorer")}
                  </Label>
                </div>
                <div className="text-sm text-gray-500 dark:text-gray-400">
                  {t("page.codeExplorerDescription")}
                </div>
              </div>
            </div>
          </div>

          {/* Danger Zone */}
          <div
            id={SECTION_IDS.dangerZone}
            className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-red-200 dark:border-red-800"
          >
            <h2 className="text-lg font-medium text-red-600 dark:text-red-400 mb-4">
              {t("dangerZone.title")}
            </h2>

            <div className="space-y-4">
              <div
                id={SETTING_IDS.reset}
                className="flex items-start justify-between flex-col sm:flex-row sm:items-center gap-4"
              >
                <div>
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white">
                    {t("dangerZone.resetEverything")}
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {t("dangerZone.resetDescription")}
                  </p>
                </div>
                <button
                  onClick={() => setIsResetDialogOpen(true)}
                  disabled={isResetting}
                  className="rounded-md border border-transparent bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isResetting
                    ? t("dangerZone.resetting")
                    : t("dangerZone.resetEverything")}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={isResetDialogOpen}
        title={t("dangerZone.resetEverything")}
        message={t("dangerZone.resetConfirmation")}
        confirmText={
          isResetting
            ? t("dangerZone.resetting")
            : t("dangerZone.resetEverything")
        }
        cancelText={t("common:cancel")}
        confirmDisabled={isResetting}
        onConfirm={handleResetEverything}
        onCancel={() => setIsResetDialogOpen(false)}
      />
    </div>
  );
}

export function GeneralSettings({ appVersion }: { appVersion: string | null }) {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation("settings");

  return (
    <div
      id={SECTION_IDS.general}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6"
    >
      <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
        {t("general.title")}
      </h2>

      <div className="space-y-4 mb-4">
        <div id={SETTING_IDS.theme} className="flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {t("general.theme")}
          </label>

          <div className="relative bg-gray-100 dark:bg-gray-700 rounded-lg p-1 flex">
            {(["system", "light", "dark"] as const).map((option) => (
              <button
                key={option}
                onClick={() => setTheme(option)}
                className={`
                px-4 py-1.5 text-sm font-medium rounded-md
                transition-all duration-200
                ${
                  theme === option
                    ? "bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                }
              `}
              >
                {option === "system"
                  ? t("general.themeSystem")
                  : option === "light"
                    ? t("general.themeLight")
                    : t("general.themeDark")}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <LanguageSelector />
      </div>

      <div id={SETTING_IDS.zoom} className="mt-4">
        <ZoomSelector />
      </div>

      <div id={SETTING_IDS.autoUpdate} className="space-y-1 mt-4">
        <AutoUpdateSwitch />
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("general.autoUpdateDescription")}
        </div>
      </div>

      <div id={SETTING_IDS.releaseChannel} className="mt-4">
        <ReleaseChannelSelector />
      </div>

      <div id={SETTING_IDS.runtimeMode} className="mt-4">
        <RuntimeModeSelector />
      </div>
      <div id={SETTING_IDS.nodePath} className="mt-4">
        <NodePathSelector />
      </div>
      <div id={SETTING_IDS.customAppsFolder} className="mt-4">
        <CustomAppsFolderSelector />
      </div>

      <div className="flex items-center text-sm text-gray-500 dark:text-gray-400 mt-4">
        <span className="mr-2 font-medium">{t("general.appVersion")}</span>
        <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-gray-800 dark:text-gray-200 font-mono">
          {appVersion ? appVersion : "-"}
        </span>
      </div>
    </div>
  );
}

export function WorkflowSettings() {
  const { t } = useTranslation("settings");
  return (
    <div
      id={SECTION_IDS.workflow}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6"
    >
      <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
        {t("workflow.title")}
      </h2>

      <div id={SETTING_IDS.defaultChatMode} className="mt-4">
        <DefaultChatModeSelector />
      </div>

      <div id={SETTING_IDS.autoApprove} className="space-y-1 mt-4">
        <AutoApproveSwitch showToast={false} />
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("workflow.autoApproveDescription")}
        </div>
      </div>

      <div id={SETTING_IDS.autoFix} className="space-y-1 mt-4">
        <AutoFixProblemsSwitch />
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("workflow.autoFixProblemsDescription")}
        </div>
      </div>

      <div id={SETTING_IDS.appBlueprint} className="space-y-1 mt-4">
        <AppBlueprintSwitch />
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("workflow.appBlueprintDescription")}
        </div>
      </div>

      <div id={SETTING_IDS.autoExpandPreview} className="space-y-1 mt-4">
        <AutoExpandPreviewSwitch />
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("workflow.autoExpandPreviewDescription")}
        </div>
      </div>

      <div id={SETTING_IDS.keepPreviewsRunning} className="space-y-1 mt-4">
        <KeepPreviewsRunningSwitch />
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("workflow.keepPreviewsRunningDescription")}
        </div>
      </div>

      <div id={SETTING_IDS.chatEventNotification} className="space-y-1 mt-4">
        <ChatEventNotificationSwitch />
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("workflow.chatEventNotificationDescription")}
        </div>
      </div>
    </div>
  );
}
export function AISettings() {
  const { t } = useTranslation("settings");
  return (
    <div
      id={SECTION_IDS.ai}
      className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6"
    >
      <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
        {t("ai.title")}
      </h2>

      <div id={SETTING_IDS.thinkingBudget} className="mt-4">
        <ThinkingBudgetSelector />
      </div>

      <div id={SETTING_IDS.maxChatTurns} className="mt-4">
        <MaxChatTurnsSelector />
      </div>

      <div id={SETTING_IDS.maxToolCallSteps} className="mt-4">
        <MaxToolCallStepsSelector />
      </div>

      <div id={SETTING_IDS.contextCompaction} className="space-y-1 mt-4">
        <ContextCompactionSwitch />
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {t("ai.contextCompactionDescription")}
        </div>
      </div>
    </div>
  );
}
