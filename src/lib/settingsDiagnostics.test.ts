import { describe, expect, it } from "vitest";
import { DebugSettingsSchema } from "@/ipc/types/misc";
import type { ModelSelection, UserSettings } from "@/lib/schemas";
import {
  getSessionDebugSettings,
  getSharedSettingsDiagnostics,
} from "@/lib/settingsDiagnostics";

const SECRET = "super-secret-value";
const secret = { value: SECRET };
const selectedModel: ModelSelection = {
  provider: "openai",
  name: "gpt",
  connection: "subscription",
  effortLevel: "high",
} as ModelSelection;

function makeSettings(overrides: Partial<UserSettings> = {}): UserSettings {
  return {
    selectedModel: { provider: "auto", name: "auto" },
    providerSettings: {},
    selectedTemplateId: "react",
    enableAutoUpdate: true,
    releaseChannel: "stable",
    ...overrides,
  } as UserSettings;
}

const connectedSettings = makeSettings({
  githubAccessToken: secret,
  githubUser: { email: "person@example.com" },
  gitlab: {
    instanceUrl: "https://gitlab.internal.example",
    accessToken: secret,
    user: { username: "gitlab-person" },
  },
  vercelAccessToken: secret,
  cloudflareAccessToken: secret,
  coolify: { instanceUrl: "https://coolify.example", accessToken: secret },
  supabase: { accessToken: secret },
  neon: { accessToken: secret },
  providerSettings: { openai: { apiKey: secret } },
  customAppsFolder: "/home/person/secret-apps",
  telemetryUserId: "telemetry-user-id",
  // Kept by the passthrough schema; must never be sent.
  futureSecretSetting: SECRET,
} as Partial<UserSettings>);

describe("getSharedSettingsDiagnostics", () => {
  it("reports connections as booleans without credentials or accounts", () => {
    const diagnostics = getSharedSettingsDiagnostics(connectedSettings);

    expect(diagnostics).toMatchObject({
      githubConnected: true,
      gitlabConnected: true,
      vercelConnected: true,
      cloudflareConnected: true,
      coolifyConnected: true,
      supabaseConnected: true,
      neonConnected: true,
    });
    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("person");
    expect(serialized).not.toContain("example");
  });

  it("reports unset settings as null and no connections", () => {
    expect(getSharedSettingsDiagnostics(makeSettings())).toMatchObject({
      enableShellTool: null,
      maxToolCallSteps: null,
      githubConnected: false,
      supabaseConnected: false,
    });
  });

  it("does not count an empty credential as connected", () => {
    expect(
      getSharedSettingsDiagnostics(
        makeSettings({ vercelAccessToken: { value: "" } }),
      ).vercelConnected,
    ).toBe(false);
  });
});

describe("getSessionDebugSettings", () => {
  // A change to this list adds or removes data in uploaded chat sessions, so it
  // should be a deliberate, reviewed edit.
  it("sends exactly the approved settings", () => {
    expect(
      Object.keys(
        getSessionDebugSettings(makeSettings(), selectedModel),
      ).sort(),
    ).toEqual(
      [
        "acceptedCommunityCode",
        "agentToolConsents",
        "autoApproveChanges",
        "autoApproveNonSchemaSql",
        "autoApproveSafeMcpTools",
        "autoExpandPreviewPanel",
        "autoFixReviewIssues",
        "blockUnsafeNpmPackages",
        "chatgptFastMode",
        "cloudflareConnected",
        "coolifyConnected",
        "customNodePath",
        "defaultChatMode",
        "disablePreviewNodeAutoInstall",
        "disableSandboxedE2eTests",
        "effortLevel",
        "enableAdvancedSubagents",
        "enableAppBlueprint",
        "enableAppPreviewDomains",
        "enableAutoReview",
        "enableAutoUpdate",
        "enableChatEventNotifications",
        "enableClaudeCodeSubscription",
        "enableCodeExplorer",
        "enableContextCompaction",
        "enableDyadPro",
        "enableExplorerSubagent",
        "enableGitlabPublishing",
        "enableImplementerSubagent",
        "enableMcpToolSearch",
        "enableMultiWindow",
        "enableOwnServerDeployment",
        "enablePnpmMinimumReleaseAgeWarning",
        "enablePreviewCookieIsolation",
        "enableProLazyEditsMode",
        "enableProSmartFilesContextMode",
        "enableProWebSearch",
        "enableReviewButton",
        "enableSandboxScriptExecution",
        "enableShellTool",
        "enableSuggestedPrompts",
        "enableSupabaseWriteSqlMigration",
        "enableTestRunInPreview",
        "enableTestingForNewApps",
        "experiments",
        "githubConnected",
        "gitlabConnected",
        "hasCustomAppsFolder",
        "hidePnpmMinimumReleaseAgeWarning",
        "isTestMode",
        "language",
        "maxChatTurnsInContext",
        "maxToolCallSteps",
        "neonConnected",
        "neverSuggestPluginSlugs",
        "nodeRuntimePreference",
        "previewDeviceMode",
        "previewIdleTimeoutPolicy",
        "proLazyEditsMode",
        "proModelUsage",
        "proSmartContextOption",
        "providerSetupStatus",
        "releaseChannel",
        "runTypeScriptForWholeProject",
        "runtimeMode2",
        "selectedChatMode",
        "selectedModel",
        "selectedTemplateId",
        "selectedThemeId",
        "skipPruneEdgeFunctions",
        "supabaseConnected",
        "testHeaded",
        "testParallel",
        "testSlowMo",
        "vercelConnected",
        "zoomLevel",
      ].sort(),
    );
  });

  it("excludes secrets, account details, the apps folder and unknown keys", () => {
    const debugSettings = getSessionDebugSettings(
      connectedSettings,
      selectedModel,
    );

    expect(debugSettings.hasCustomAppsFolder).toBe(true);
    expect(debugSettings.providerSetupStatus).toEqual({ openai: true });
    const serialized = JSON.stringify(debugSettings);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("person");
    expect(serialized).not.toContain("telemetry-user-id");
  });

  it("includes the chat's model routing", () => {
    expect(
      getSessionDebugSettings(makeSettings(), selectedModel).selectedModel,
    ).toEqual({
      provider: "openai",
      name: "gpt",
      customModelId: undefined,
      connection: "subscription",
    });
  });

  it("keeps every field through the bundle schema", () => {
    const debugSettings = getSessionDebugSettings(
      makeSettings({ selectedThemeId: "custom:12" }),
      selectedModel,
    );

    // The schema strips unknown keys, so a field missing there never arrives.
    expect(DebugSettingsSchema.parse(debugSettings)).toEqual(debugSettings);
    expect(debugSettings.selectedThemeId).toBe("custom:12");
  });
});
