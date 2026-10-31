import {
  isSupabaseConnected,
  type ModelSelection,
  type UserSettings,
} from "@/lib/schemas";
import type { DebugSettings } from "@/ipc/types/misc";

/**
 * Settings reported through both telemetry and uploaded chat sessions.
 *
 * Only fixed values and numbers belong here. Settings are read one by one so
 * that a new setting, or an unknown key kept by the passthrough schema, is
 * never sent until someone adds it. A null value means the setting was never
 * stored and nothing filled in a default.
 */
export function getSharedSettingsDiagnostics(settings: UserSettings) {
  return {
    autoApproveNonSchemaSql: settings.autoApproveNonSchemaSql ?? null,
    autoApproveSafeMcpTools: settings.autoApproveSafeMcpTools ?? null,
    enableShellTool: settings.enableShellTool ?? null,
    blockUnsafeNpmPackages: settings.blockUnsafeNpmPackages ?? null,
    enableCodeExplorer: settings.enableCodeExplorer ?? null,
    enableExplorerSubagent: settings.enableExplorerSubagent ?? null,
    enableImplementerSubagent: settings.enableImplementerSubagent ?? null,
    enableAdvancedSubagents: settings.enableAdvancedSubagents ?? null,
    enableAutoReview: settings.enableAutoReview ?? null,
    enableReviewButton: settings.enableReviewButton ?? null,
    autoFixReviewIssues: settings.autoFixReviewIssues ?? null,
    enableContextCompaction: settings.enableContextCompaction ?? null,
    enableMcpToolSearch: settings.enableMcpToolSearch ?? null,
    enableSandboxScriptExecution: settings.enableSandboxScriptExecution ?? null,
    enableSuggestedPrompts: settings.enableSuggestedPrompts ?? null,
    enableMultiWindow: settings.enableMultiWindow ?? null,
    enableOwnServerDeployment: settings.enableOwnServerDeployment ?? null,
    enableGitlabPublishing: settings.enableGitlabPublishing ?? null,
    enableTestRunInPreview: settings.enableTestRunInPreview ?? null,
    disableSandboxedE2eTests: settings.disableSandboxedE2eTests ?? null,
    enableAppPreviewDomains: settings.enableAppPreviewDomains ?? null,
    enablePreviewCookieIsolation: settings.enablePreviewCookieIsolation ?? null,
    proModelUsage: settings.proModelUsage ?? null,
    chatgptFastMode: settings.chatgptFastMode ?? null,
    language: settings.language ?? null,
    nodeRuntimePreference: settings.nodeRuntimePreference ?? null,
    disablePreviewNodeAutoInstall:
      settings.disablePreviewNodeAutoInstall ?? null,
    previewIdleTimeoutPolicy: settings.previewIdleTimeoutPolicy ?? null,
    maxToolCallSteps: settings.maxToolCallSteps ?? null,
    // Whether a credential is stored, never the credential or its account.
    githubConnected: !!settings.githubAccessToken?.value,
    gitlabConnected: !!settings.gitlab?.accessToken?.value,
    vercelConnected: !!settings.vercelAccessToken?.value,
    cloudflareConnected: !!settings.cloudflareAccessToken?.value,
    coolifyConnected: !!settings.coolify?.accessToken?.value,
    supabaseConnected: isSupabaseConnected(settings),
    neonConnected: !!settings.neon?.accessToken?.value,
  };
}

/**
 * Settings for an uploaded chat session, which the reporter can read before
 * sending. All Secret fields (API keys, OAuth tokens) are excluded.
 * Provider setup status is derived as boolean flags only.
 */
export function getSessionDebugSettings(
  settings: UserSettings,
  selectedModel: ModelSelection,
): DebugSettings {
  // Build provider setup status: { providerName: hasApiKey }
  const providerSetupStatus: Record<string, boolean> = {};
  if (settings.providerSettings) {
    for (const [provider, providerSetting] of Object.entries(
      settings.providerSettings,
    )) {
      providerSetupStatus[provider] = !!providerSetting?.apiKey?.value;
    }
  }

  return {
    ...getSharedSettingsDiagnostics(settings),
    selectedModel: {
      name: selectedModel.name,
      provider: selectedModel.provider,
      customModelId: selectedModel.customModelId,
      connection: selectedModel.connection,
    },
    selectedChatMode: settings.selectedChatMode ?? null,
    defaultChatMode: settings.defaultChatMode ?? null,
    autoApproveChanges: settings.autoApproveChanges ?? null,
    enableDyadPro: settings.enableDyadPro ?? null,
    effortLevel: selectedModel.effortLevel,
    maxChatTurnsInContext: settings.maxChatTurnsInContext ?? null,
    enableAutoUpdate: settings.enableAutoUpdate,
    releaseChannel: settings.releaseChannel,
    runtimeMode2: settings.runtimeMode2 ?? null,
    zoomLevel: settings.zoomLevel ?? null,
    previewDeviceMode: settings.previewDeviceMode ?? null,
    enableProLazyEditsMode: settings.enableProLazyEditsMode ?? null,
    proLazyEditsMode: settings.proLazyEditsMode ?? null,
    enableProSmartFilesContextMode:
      settings.enableProSmartFilesContextMode ?? null,
    enableProWebSearch: settings.enableProWebSearch ?? null,
    proSmartContextOption: settings.proSmartContextOption ?? null,
    enableSupabaseWriteSqlMigration:
      settings.enableSupabaseWriteSqlMigration ?? null,
    agentToolConsents: settings.agentToolConsents ?? null,
    experiments: settings.experiments
      ? Object.fromEntries(
          Object.entries(settings.experiments).filter(
            ([, v]) => typeof v === "boolean",
          ),
        )
      : null,
    customNodePath: settings.customNodePath ?? null,
    providerSetupStatus,
    enableAppBlueprint: settings.enableAppBlueprint ?? null,
    enableTestingForNewApps: settings.enableTestingForNewApps ?? null,
    enableClaudeCodeSubscription: settings.enableClaudeCodeSubscription ?? null,
    selectedTemplateId: settings.selectedTemplateId,
    selectedThemeId: settings.selectedThemeId ?? null,
    runTypeScriptForWholeProject: settings.runTypeScriptForWholeProject ?? null,
    autoExpandPreviewPanel: settings.autoExpandPreviewPanel ?? null,
    testHeaded: settings.testHeaded ?? null,
    testParallel: settings.testParallel ?? null,
    testSlowMo: settings.testSlowMo ?? null,
    skipPruneEdgeFunctions: settings.skipPruneEdgeFunctions ?? null,
    enablePnpmMinimumReleaseAgeWarning:
      settings.enablePnpmMinimumReleaseAgeWarning ?? null,
    hidePnpmMinimumReleaseAgeWarning:
      settings.hidePnpmMinimumReleaseAgeWarning ?? null,
    acceptedCommunityCode: settings.acceptedCommunityCode ?? null,
    enableChatEventNotifications: settings.enableChatEventNotifications ?? null,
    isTestMode: settings.isTestMode ?? null,
    hasCustomAppsFolder: !!settings.customAppsFolder,
    neverSuggestPluginSlugs: settings.neverSuggestPluginSlugs ?? null,
  };
}
