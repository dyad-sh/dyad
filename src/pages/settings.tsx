import { useEffect, useState, type ReactNode } from "react";
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
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AppBlueprintSwitch } from "@/components/AppBlueprintSwitch";
import { TestingForNewAppsSwitch } from "@/components/TestingForNewAppsSwitch";
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

const hint = "text-[13px] leading-relaxed text-muted-foreground";

/**
 * A single settings group: a sticky label + description in the left rail and its
 * controls in the right column. Sections are separated by a hairline rule rather
 * than boxed cards, so the surface stays flat — no elevation shadows.
 */
function SettingsSection({
  id,
  title,
  description,
  tone = "default",
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  tone?: "default" | "danger";
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={cn(
        "grid grid-cols-1 gap-x-12 gap-y-5 border-t py-8 first:border-t-0 first:pt-0 md:grid-cols-[minmax(150px,190px)_1fr]",
        "scroll-mt-20",
        tone === "danger" ? "border-destructive/20" : "border-border/60",
      )}
    >
      <div className="self-start md:sticky md:top-6">
        <h2
          className={cn(
            "text-[15px] font-semibold tracking-tight",
            tone === "danger" ? "text-destructive" : "text-foreground",
          )}
        >
          {title}
        </h2>
        {description && (
          <p className={cn("mt-1.5", hint)}>{description}</p>
        )}
      </div>
      <div className="min-w-0 space-y-6">{children}</div>
    </section>
  );
}

export default function SettingsPage() {
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
      showSuccess("Successfully reset everything. Restart the application.");
    } catch (error) {
      console.error("Error resetting:", error);
      showError(
        error instanceof Error ? error.message : "An unknown error occurred",
      );
    } finally {
      setIsResetting(false);
      setIsResetDialogOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-6 py-8 md:px-10">
        <BackButton />

        <header className="mt-1 mb-9">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Settings
          </h1>
          <p className={cn("mt-1", hint)}>
            Manage your preferences, providers, and integrations.
          </p>
        </header>

        <div>
          <GeneralSettings appVersion={appVersion} />
          <WorkflowSettings />
          <AISettings />

          <SettingsSection
            id={SECTION_IDS.providers}
            title="Model Providers"
            description="Connect the AI providers Dyad uses to build and run your apps."
          >
            <ProviderSettingsGrid />
          </SettingsSection>

          <SettingsSection
            id={SECTION_IDS.telemetry}
            title="Telemetry"
            description="Anonymous usage data that helps improve Dyad."
          >
            <div id={SETTING_IDS.telemetry} className="space-y-1.5">
              <TelemetrySwitch />
              <p className={hint}>
                This records anonymous usage data to improve the product.
              </p>
            </div>

            <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span className="font-medium">Telemetry ID</span>
              <span className="rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 font-mono text-foreground">
                {settings ? settings.telemetryUserId : "n/a"}
              </span>
            </div>
          </SettingsSection>

          <SettingsSection
            id={SECTION_IDS.integrations}
            title="Integrations"
            description="Link Dyad to the services you deploy and store data with."
          >
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
          </SettingsSection>

          <SettingsSection
            id={SECTION_IDS.agentPermissions}
            title="Agent Permissions"
            description="Control what the agent can do on your behalf. Requires Pro."
          >
            <AgentToolsSettings />
          </SettingsSection>

          <SettingsSection
            id={SECTION_IDS.advanced}
            title="Advanced"
            description="We recommend keeping the defaults unless something isn't working."
          >
            <div
              id={SETTING_IDS.enableSandboxScriptExecution}
              className="space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <Switch
                  id="enable-sandbox-script-execution"
                  aria-label="Enable sandbox script execution"
                  checked={!!settings?.enableSandboxScriptExecution}
                  onCheckedChange={(checked) => {
                    updateSettings({
                      enableSandboxScriptExecution: checked,
                    });
                  }}
                />
                <Label htmlFor="enable-sandbox-script-execution">
                  Enable sandbox script execution
                </Label>
              </div>
              <p className={hint}>
                Allow local-agent attachment scripts to inspect files with
                execute_sandbox_script.
              </p>
            </div>

            <div id={SETTING_IDS.blockUnsafeNpmPackages}>
              <BlockUnsafeNpmPackagesSwitch />
            </div>

            <div id={SETTING_IDS.autoApproveNonSchemaSql}>
              <AutoApproveSqlSwitch />
            </div>
          </SettingsSection>

          <SettingsSection
            id={SECTION_IDS.experiments}
            title="Experiments"
            description="Early features that may not be stable yet. Enable at your own risk."
          >
            <div id={SETTING_IDS.enableCloudSandbox}>
              <CloudSandboxExperimentSwitch />
            </div>

            <div id={SETTING_IDS.autoApproveSafeMcpTools}>
              <AutoApproveMcpSwitch />
            </div>

            <div id={SETTING_IDS.enableMcpToolSearch} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Switch
                  id="enable-mcp-tool-search"
                  aria-label="Enable MCP tool search"
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
                  Enable MCP tool search
                </Label>
              </div>
              <p className={hint}>
                When many MCP tools are enabled, let the agent search for the
                tools on demand instead of listing every tool in its context.
                Requires sandbox script execution.
              </p>
              {!settings?.enableSandboxScriptExecution && (
                <p className="text-xs text-amber-700 dark:text-amber-500">
                  Cannot be enabled unless sandbox script execution is on.
                </p>
              )}
            </div>

            <div
              id={SETTING_IDS.enablePnpmMinimumReleaseAgeWarning}
              className="space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <Switch
                  id="enable-pnpm-minimum-release-age-warning"
                  aria-label="Enable pnpm upgrade warning"
                  checked={!!settings?.enablePnpmMinimumReleaseAgeWarning}
                  onCheckedChange={(checked) => {
                    updateSettings({
                      enablePnpmMinimumReleaseAgeWarning: checked,
                    });
                  }}
                />
                <Label htmlFor="enable-pnpm-minimum-release-age-warning">
                  Enable pnpm upgrade warning
                </Label>
              </div>
              <p className={hint}>
                Show the pnpm release-age warning toast and one-click pnpm
                upgrade action.
              </p>
            </div>

            <div
              id={SETTING_IDS.enableSelectAppFromHomeChatInput}
              className="space-y-1.5"
            >
              <div className="flex items-center gap-2">
                <Switch
                  id="enable-select-app-from-home-chat-input"
                  aria-label="Enable Select App from Home Chat Input"
                  checked={!!settings?.enableSelectAppFromHomeChatInput}
                  onCheckedChange={(checked) => {
                    updateSettings({
                      enableSelectAppFromHomeChatInput: checked,
                    });
                  }}
                />
                <Label htmlFor="enable-select-app-from-home-chat-input">
                  Enable Select App from Home Chat Input
                </Label>
              </div>
              <p className={hint}>
                Show an app selector in the home chat input to start a chat
                referencing an existing app.
              </p>
            </div>

            <div id={SETTING_IDS.enableCodeExplorer} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Switch
                  id="enable-code-explorer"
                  aria-label="Enable code explorer (Pro)"
                  checked={!!settings?.enableCodeExplorer}
                  onCheckedChange={(checked) => {
                    updateSettings({
                      enableCodeExplorer: checked,
                    });
                  }}
                />
                <Label htmlFor="enable-code-explorer">
                  Enable code explorer (Pro)
                </Label>
              </div>
              <p className={hint}>
                Let the local agent explore configured TypeScript projects with
                a compiler-backed code graph.
              </p>
            </div>
          </SettingsSection>

          <SettingsSection
            id={SECTION_IDS.dangerZone}
            title="Danger Zone"
            description="Irreversible actions. Proceed with care."
            tone="danger"
          >
            <div
              id={SETTING_IDS.reset}
              className="flex flex-col gap-4 rounded-xl border border-destructive/25 bg-destructive/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between dark:bg-destructive/[0.08]"
            >
              <div>
                <h3 className="text-sm font-medium text-foreground">
                  Reset Everything
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  This will delete all your apps, chats, and settings. This
                  action cannot be undone.
                </p>
              </div>
              <Button
                variant="destructive"
                onClick={() => setIsResetDialogOpen(true)}
                disabled={isResetting}
                className="shrink-0"
              >
                {isResetting ? "Resetting..." : "Reset Everything"}
              </Button>
            </div>
          </SettingsSection>
        </div>
      </div>

      <ConfirmationDialog
        isOpen={isResetDialogOpen}
        title="Reset Everything"
        message="Are you sure you want to reset everything? This will delete all your apps, chats, and settings. This action cannot be undone."
        confirmText={isResetting ? "Resetting..." : "Reset Everything"}
        cancelText="Cancel"
        confirmDisabled={isResetting}
        onConfirm={handleResetEverything}
        onCancel={() => setIsResetDialogOpen(false)}
      />
    </div>
  );
}

export function GeneralSettings({ appVersion }: { appVersion: string | null }) {
  const { theme, setTheme } = useTheme();

  return (
    <SettingsSection
      id={SECTION_IDS.general}
      title="General"
      description="Appearance, language, and how Dyad runs on your machine."
    >
      <div id={SETTING_IDS.theme} className="flex items-center gap-4">
        <label className="text-sm font-medium text-foreground">Theme</label>

        <div className="inline-flex rounded-lg border border-border/50 bg-muted/60 p-1">
          {(["system", "light", "dark"] as const).map((option) => (
            <button
              key={option}
              onClick={() => setTheme(option)}
              className={cn(
                "rounded-md px-4 py-1.5 text-sm font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                theme === option
                  ? "border border-border/70 bg-background-lightest text-foreground"
                  : "border border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <LanguageSelector />

      <div id={SETTING_IDS.zoom}>
        <ZoomSelector />
      </div>

      <div id={SETTING_IDS.autoUpdate} className="space-y-1.5">
        <AutoUpdateSwitch />
        <p className={hint}>
          This will automatically update the app when new versions are
          available.
        </p>
      </div>

      <div id={SETTING_IDS.releaseChannel}>
        <ReleaseChannelSelector />
      </div>

      <div id={SETTING_IDS.runtimeMode}>
        <RuntimeModeSelector />
      </div>
      <div id={SETTING_IDS.nodePath}>
        <NodePathSelector />
      </div>
      <div id={SETTING_IDS.customAppsFolder}>
        <CustomAppsFolderSelector />
      </div>

      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <span className="font-medium">App Version</span>
        <span className="rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 font-mono text-foreground">
          {appVersion ? appVersion : "-"}
        </span>
      </div>
    </SettingsSection>
  );
}

export function WorkflowSettings() {
  return (
    <SettingsSection
      id={SECTION_IDS.workflow}
      title="Workflow"
      description="How Dyad handles code changes, previews, and notifications."
    >
      <div id={SETTING_IDS.defaultChatMode}>
        <DefaultChatModeSelector />
      </div>

      <div id={SETTING_IDS.autoApprove} className="space-y-1.5">
        <AutoApproveSwitch showToast={false} />
        <p className={hint}>
          This will automatically approve code changes and run them.
        </p>
      </div>

      <div id={SETTING_IDS.appBlueprint} className="space-y-1.5">
        <AppBlueprintSwitch />
        <p className={hint}>
          When creating a new app, generate a lightweight app blueprint (name,
          design, color, template) before building.
        </p>
      </div>

      <div id={SETTING_IDS.testingForNewApps} className="space-y-1.5">
        <TestingForNewAppsSwitch />
        <p className={hint}>
          When creating a new app, opt it into AI E2E testing by default. This
          only affects apps created while this setting is on; existing apps are
          unchanged.
        </p>
      </div>

      <div id={SETTING_IDS.autoExpandPreview} className="space-y-1.5">
        <AutoExpandPreviewSwitch />
        <p className={hint}>
          Automatically expand the preview panel when code changes are made.
        </p>
      </div>

      <div id={SETTING_IDS.keepPreviewsRunning} className="space-y-1.5">
        <KeepPreviewsRunningSwitch />
        <p className={hint}>
          Note: this may take more memory but allows faster preview loads when
          switching apps.
        </p>
      </div>

      <div id={SETTING_IDS.chatEventNotification} className="space-y-1.5">
        <ChatEventNotificationSwitch />
        <p className={hint}>
          Show native notifications when a chat response completes or a
          questionnaire needs your input while the app is not focused.
        </p>
      </div>
    </SettingsSection>
  );
}

export function AISettings() {
  return (
    <SettingsSection
      id={SECTION_IDS.ai}
      title="AI"
      description="Tune how the model reasons, and how long conversations run."
    >
      <div id={SETTING_IDS.thinkingBudget}>
        <ThinkingBudgetSelector />
      </div>

      <div id={SETTING_IDS.maxChatTurns}>
        <MaxChatTurnsSelector />
      </div>

      <div id={SETTING_IDS.maxToolCallSteps}>
        <MaxToolCallStepsSelector />
      </div>

      <div id={SETTING_IDS.contextCompaction} className="space-y-1.5">
        <ContextCompactionSwitch />
        <p className={hint}>
          Automatically compact long conversations to stay within context
          limits. Original messages are preserved in the app data directory.
        </p>
      </div>
    </SettingsSection>
  );
}
