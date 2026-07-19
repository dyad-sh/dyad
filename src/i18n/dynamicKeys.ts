export interface DynamicTranslationCall {
  filePath: string;
  signature: string;
  keys: string[];
}

export const DYNAMIC_TRANSLATION_CALLS: DynamicTranslationCall[] = [
  {
    filePath: "src/pages/app-details.tsx",
    signature: "t(descriptionKey)",
    keys: [
      "home:integrations.mutualExclusion.supabaseUnavailable",
      "home:integrations.mutualExclusion.neonUnavailable",
    ],
  },
  {
    filePath: "src/components/AppsViewTabs.tsx",
    signature: "t(tab.labelKey)",
    keys: ["common:apps", "common:collections"],
  },
  {
    filePath: "src/components/MigrationSqlPreviewDialog.tsx",
    signature:
      "t(`integrations.migration.preview.destructive.reasons.${reason}`)",
    keys: [
      "home:integrations.migration.preview.destructive.reasons.drop_table",
      "home:integrations.migration.preview.destructive.reasons.drop_column",
      "home:integrations.migration.preview.destructive.reasons.alter_column_type",
      "home:integrations.migration.preview.destructive.reasons.truncate",
      "home:integrations.migration.preview.destructive.reasons.drop_schema",
      "home:integrations.migration.preview.destructive.reasons.schema_hazard",
    ],
  },
  {
    filePath: "src/components/chat/DyadGit.tsx",
    signature: "t(`git.${label}`, { count: paths.length })",
    keys: [
      "chat:git.staged",
      "chat:git.unstaged",
      "chat:git.untracked",
      "chat:git.conflicted",
    ],
  },
  {
    filePath: "src/components/preview_panel/DatabaseSection.tsx",
    signature: "t(`integrations.database.${metaKey}.title`)",
    keys: [
      "home:integrations.database.production.title",
      "home:integrations.database.development.title",
    ],
  },
  {
    filePath: "src/components/preview_panel/DatabaseSection.tsx",
    signature: "t(`integrations.database.${metaKey}.description`)",
    keys: [
      "home:integrations.database.production.description",
      "home:integrations.database.development.description",
    ],
  },
  {
    filePath: "src/components/preview_panel/DatabaseSection.tsx",
    signature:
      't( `integrations.database.${ selectedEnv === "prod" ? "production" : "development" }.title`, )',
    keys: [
      "home:integrations.database.production.title",
      "home:integrations.database.development.title",
    ],
  },
  {
    filePath: "src/components/settings/ProviderSettingsHeader.tsx",
    signature: "t(getKeyButtonText({ isConfigured, isDyad }))",
    keys: [
      "settings:manageDyadPro",
      "settings:setupDyadPro",
      "settings:ai.manageApiKeys",
      "settings:ai.setupApiKey",
    ],
  },
  {
    filePath: "src/components/settings/ProviderSettingsPage.tsx",
    signature: "t(getApiKeyValidationDialogTitle(apiKeyValidationDialog))",
    keys: [
      "settings:ai.apiKeyRejected",
      "settings:ai.apiKeyVerificationFailed",
    ],
  },
  {
    filePath: "src/components/chat/DyadQuestionnaire.tsx",
    signature: "t(meta.key)",
    keys: ["chat:freeText", "chat:singleChoice", "chat:multipleChoice"],
  },
  {
    filePath: "src/components/LibraryCard.tsx",
    signature: "t(`library.${config.labelKey}`)",
    keys: ["home:library.theme", "home:library.prompt"],
  },
  {
    filePath: "src/components/LibraryFilterTabs.tsx",
    signature: "t(`library.${opt.labelKey}`)",
    keys: [
      "home:library.all",
      "home:library.themes",
      "home:library.prompts",
      "home:library.media",
    ],
  },
  {
    filePath: "src/components/LibraryList.tsx",
    signature: "t(`library.${section.labelKey}`)",
    keys: [
      "home:library.all",
      "home:library.themes",
      "home:library.prompts",
      "home:library.media",
    ],
  },
  {
    filePath: "src/components/preview_panel/VisualEditingToolbar.tsx",
    signature: "t(`preview.visualEditing.fontWeights.${opt.labelKey}`)",
    keys: [
      "home:preview.visualEditing.fontWeights.default",
      "home:preview.visualEditing.fontWeights.thin",
      "home:preview.visualEditing.fontWeights.extraLight",
      "home:preview.visualEditing.fontWeights.light",
      "home:preview.visualEditing.fontWeights.normal",
      "home:preview.visualEditing.fontWeights.medium",
      "home:preview.visualEditing.fontWeights.semiBold",
      "home:preview.visualEditing.fontWeights.bold",
      "home:preview.visualEditing.fontWeights.extraBold",
      "home:preview.visualEditing.fontWeights.black",
    ],
  },
];
