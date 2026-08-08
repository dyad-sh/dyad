/**
 * Centralized React Query key factory.
 *
 * This pattern provides:
 * - Type-safe query keys with full autocomplete
 * - Hierarchical structure for easy invalidation (invalidate parent to invalidate children)
 * - Consistent naming across the codebase
 * - Single source of truth for all query keys
 *
 * Usage:
 *   queryKey: queryKeys.apps.detail({ appId })
 *   queryClient.invalidateQueries({ queryKey: queryKeys.apps.all })
 *
 * @see https://tkdodo.eu/blog/effective-react-query-keys
 */

export const queryKeys = {
  // ─────────────────────────────────────────────────────────────────────────────
  // System
  // ─────────────────────────────────────────────────────────────────────────────
  system: {
    all: ["system"] as const,
    appVersion: ["system", "appVersion"] as const,
    platform: ["system", "platform"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Settings
  // ─────────────────────────────────────────────────────────────────────────────
  settings: {
    all: ["settings"] as const,
    user: ["settings", "user"] as const,
    envVars: ["settings", "envVars"] as const,
  },

  storage: {
    all: ["storage"] as const,
    status: (localVaultPath?: string) =>
      ["storage", "status", localVaultPath ?? ""] as const,
  },

  vercelBlob: {
    all: ["vercelBlob"] as const,
    status: ["vercelBlob", "status"] as const,
  },

  vector: {
    all: ["vector"] as const,
    overview: ["vector", "overview"] as const,
    collections: ["vector", "collections"] as const,
    sources: ({ collectionId }: { collectionId: string | null }) =>
      ["vector", "sources", collectionId] as const,
    search: ({
      collectionIds,
      query,
    }: {
      collectionIds: string[];
      query: string;
    }) => ["vector", "search", collectionIds, query] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Apps
  // ─────────────────────────────────────────────────────────────────────────────
  apps: {
    all: ["apps"] as const,
    detail: ({ appId }: { appId: number | null }) =>
      ["apps", "detail", appId] as const,
    screenshots: ({ appId }: { appId: number | null }) =>
      ["apps", "screenshots", appId] as const,
    thumbnails: ["apps", "thumbnails"] as const,
    search: ({ query }: { query: string }) =>
      ["apps", "search", query] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Chats
  // ─────────────────────────────────────────────────────────────────────────────
  chats: {
    all: ["chats"] as const,
    list: ({ appId }: { appId: number | null }) => ["chats", appId] as const,
    detail: ({ chatId }: { chatId: number | null }) =>
      ["chats", "detail", chatId] as const,
    search: ({ appId, query }: { appId: number | null; query: string }) =>
      ["chats", "search", appId, query] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Plans
  // ─────────────────────────────────────────────────────────────────────────────
  plans: {
    all: ["plans"] as const,
    forChat: ({
      appId,
      chatId,
    }: {
      appId: number | null;
      chatId: number | null;
    }) => ["plans", "forChat", appId, chatId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Proposals
  // ─────────────────────────────────────────────────────────────────────────────
  proposals: {
    all: ["proposal"] as const,
    detail: ({ chatId }: { chatId: number | undefined }) =>
      ["proposal", chatId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Git / Versions
  // ─────────────────────────────────────────────────────────────────────────────
  versions: {
    all: ["versions"] as const,
    list: ({ appId }: { appId: number | null }) => ["versions", appId] as const,
  },

  branches: {
    all: ["currentBranch"] as const,
    current: ({ appId }: { appId: number | null }) =>
      ["currentBranch", appId] as const,
  },

  uncommittedFiles: {
    all: ["uncommittedFiles"] as const,
    byApp: ({ appId }: { appId: number | null }) =>
      ["uncommittedFiles", appId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Problems / Diagnostics
  // ─────────────────────────────────────────────────────────────────────────────
  problems: {
    all: ["problems"] as const,
    byApp: ({ appId }: { appId: number | null }) =>
      ["problems", appId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Context Paths
  // ─────────────────────────────────────────────────────────────────────────────
  contextPaths: {
    all: ["context-paths"] as const,
    byApp: ({ appId }: { appId: number | null }) =>
      ["context-paths", appId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Token Counting
  // ─────────────────────────────────────────────────────────────────────────────
  tokenCount: {
    all: ["tokenCount"] as const,
    forChat: ({ chatId, input }: { chatId: number | null; input: string }) =>
      ["tokenCount", chatId, input] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Files
  // ─────────────────────────────────────────────────────────────────────────────
  files: {
    search: ({ appId, query }: { appId: number | null; query: string }) =>
      ["search-app-files", appId, query] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // App Files
  // ─────────────────────────────────────────────────────────────────────────────
  appFiles: {
    all: ["app-files"] as const,
    content: ({
      appId,
      filePath,
    }: {
      appId: number | null;
      filePath: string | null;
    }) => ["app-files", "content", appId, filePath] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // App Name Check
  // ─────────────────────────────────────────────────────────────────────────────
  appName: {
    check: ({ name }: { name: string }) => ["checkAppName", name] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Security Review
  // ─────────────────────────────────────────────────────────────────────────────
  securityReview: {
    byApp: ({ appId }: { appId: number | null }) =>
      ["security-review", appId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // App Theme
  // ─────────────────────────────────────────────────────────────────────────────
  appTheme: {
    all: ["app-theme"] as const,
    byApp: ({ appId }: { appId: number | undefined }) =>
      ["app-theme", appId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Themes (global list)
  // ─────────────────────────────────────────────────────────────────────────────
  themes: {
    all: ["themes"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Custom Themes
  // ─────────────────────────────────────────────────────────────────────────────
  customThemes: {
    all: ["custom-themes"] as const,
  },
  themeGenerationModelOptions: {
    all: ["theme-generation-model-options"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Templates
  // ─────────────────────────────────────────────────────────────────────────────
  templates: {
    all: ["templates"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Prompts
  // ─────────────────────────────────────────────────────────────────────────────
  prompts: {
    all: ["prompts"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent OS (Multi-Agent Command Center)
  // ─────────────────────────────────────────────────────────────────────────────
  agentOs: {
    all: ["agentOs"] as const,
    agents: ["agentOs", "agents"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent Tools
  // ─────────────────────────────────────────────────────────────────────────────
  agentTools: {
    all: ["agent-tools"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Language Models / Providers
  // ─────────────────────────────────────────────────────────────────────────────
  languageModels: {
    providers: ["languageModelProviders"] as const,
    byProviders: ["language-models-by-providers"] as const,
    forProvider: ({ providerId }: { providerId: string }) =>
      ["language-models", providerId] as const,
    localStatus: ({
      providerId,
      serverUrl,
    }: {
      providerId: string;
      serverUrl: string;
    }) => ["local-models", "status", providerId, serverUrl] as const,
    localDiscovery: ({ targets }: { targets: string[] }) =>
      ["local-models", "discovery", ...targets.slice().sort()] as const,
  },

  videoGeneration: {
    status: ["video-generation", "status"] as const,
    models: ["video-generation", "models"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // User Budget
  // ─────────────────────────────────────────────────────────────────────────────
  userBudget: {
    info: ["userBudgetInfo"] as const,
  },

  cloudSandboxes: {
    status: ({ appId }: { appId: number | null }) =>
      ["cloudSandboxStatus", appId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Free Agent Quota
  // ─────────────────────────────────────────────────────────────────────────────
  freeAgentQuota: {
    status: ["freeAgentQuotaStatus"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Vercel Deployments
  // ─────────────────────────────────────────────────────────────────────────────
  vercel: {
    all: ["vercel"] as const,
    projects: ["vercel", "projects"] as const,
    deploymentsByApp: ({ appId }: { appId: number }) =>
      ["vercel-deployments", appId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // App Upgrades
  // ─────────────────────────────────────────────────────────────────────────────
  appUpgrades: {
    byApp: ({ appId }: { appId: number | null }) =>
      ["app-upgrades", appId] as const,
    isCapacitor: ({ appId }: { appId: number | null }) =>
      ["is-capacitor", appId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // MCP (Model Context Protocol)
  // ─────────────────────────────────────────────────────────────────────────────
  mcp: {
    all: ["mcp"] as const,
    servers: ["mcp", "servers"] as const,
    lovableStatus: ["mcp", "lovable-status"] as const,
    toolsByServer: {
      all: ["mcp", "tools-by-server"] as const,
      list: ({ serverIds }: { serverIds: number[] }) =>
        ["mcp", "tools-by-server", serverIds] as const,
    },
    workflowsByServer: {
      all: ["mcp", "workflows-by-server"] as const,
      list: ({ serverIds }: { serverIds: number[] }) =>
        ["mcp", "workflows-by-server", serverIds] as const,
    },
    connectionStatuses: {
      all: ["mcp", "connection-statuses"] as const,
      list: ({ serverIds }: { serverIds: number[] }) =>
        ["mcp", "connection-statuses", serverIds] as const,
    },
    consents: ["mcp", "consents"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Supabase
  // ─────────────────────────────────────────────────────────────────────────────
  supabase: {
    all: ["supabase"] as const,
    organizations: ["supabase", "organizations"] as const,
    projects: ["supabase", "projects"] as const,
    branches: ({
      projectId,
      organizationSlug,
    }: {
      projectId: string;
      organizationSlug: string | null;
    }) => ["supabase", "branches", projectId, organizationSlug] as const,
    edgeLogs: ({
      projectId,
      appId,
      organizationSlug,
    }: {
      projectId: string;
      appId: number | null;
      organizationSlug: string | null;
    }) => ["supabase", "edgeLogs", projectId, appId, organizationSlug] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // GitHub
  // ─────────────────────────────────────────────────────────────────────────────
  github: {
    all: ["github"] as const,
    repos: ["github", "repos"] as const,
    account: ["github", "account"] as const,
    contents: ({
      owner,
      repo,
      path,
    }: {
      owner: string;
      repo: string;
      path: string;
    }) => ["github", "contents", owner, repo, path] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Migration
  // ─────────────────────────────────────────────────────────────────────────────
  migration: {
    all: ["migration"] as const,
    dependenciesStatus: ({ appId }: { appId: number }) =>
      ["migration", "dependencies-status", appId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Neon
  // ─────────────────────────────────────────────────────────────────────────────
  neon: {
    all: ["neon"] as const,
    projects: ["neon", "projects"] as const,
    project: ({ appId }: { appId: number | null }) =>
      ["neon", "project", appId] as const,
    emailPasswordConfig: ({
      appId,
      branchId,
    }: {
      appId: number | null;
      branchId: string | null;
    }) => ["neon", "emailPasswordConfig", appId, branchId] as const,
    branchConnectionUri: ({
      appId,
      branchType,
    }: {
      appId: number | null;
      branchType: "production" | "development";
    }) => ["neon", "branch-connection-uri", appId, branchType] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // App Environment Variables
  // ─────────────────────────────────────────────────────────────────────────────
  appEnvVars: {
    byApp: ({ appId }: { appId: number | null }) =>
      ["app-env-vars", appId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Media
  // ─────────────────────────────────────────────────────────────────────────────
  media: {
    all: ["media"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Social Media (connections + content planner)
  // ─────────────────────────────────────────────────────────────────────────────
  socialMedia: {
    all: ["socialMedia"] as const,
    connections: ["socialMedia", "connections"] as const,
    posts: ["socialMedia", "posts"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Helix coding agent (embedded dev server)
  // ─────────────────────────────────────────────────────────────────────────────
  helix: {
    all: ["helix"] as const,
    status: ["helix", "status"] as const,
  },
  openWorker: {
    all: ["openworker"] as const,
    status: ["openworker", "status"] as const,
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// Type helpers for extracting query key types
// ─────────────────────────────────────────────────────────────────────────────

/** Extract the type of a query key from a factory function or constant */
export type QueryKeyOf<T> = T extends readonly unknown[]
  ? T
  : T extends (...args: never[]) => infer R
    ? R
    : never;

/** All possible query keys (useful for typing queryClient operations) */
export type AppQueryKey =
  | QueryKeyOf<(typeof queryKeys.system)[keyof typeof queryKeys.system]>
  | QueryKeyOf<(typeof queryKeys.settings)[keyof typeof queryKeys.settings]>
  | QueryKeyOf<(typeof queryKeys.storage)[keyof typeof queryKeys.storage]>
  | QueryKeyOf<(typeof queryKeys.vercelBlob)[keyof typeof queryKeys.vercelBlob]>
  | QueryKeyOf<(typeof queryKeys.apps)[keyof typeof queryKeys.apps]>
  | QueryKeyOf<(typeof queryKeys.chats)[keyof typeof queryKeys.chats]>
  | QueryKeyOf<(typeof queryKeys.plans)[keyof typeof queryKeys.plans]>
  | QueryKeyOf<(typeof queryKeys.proposals)[keyof typeof queryKeys.proposals]>
  | QueryKeyOf<(typeof queryKeys.versions)[keyof typeof queryKeys.versions]>
  | QueryKeyOf<(typeof queryKeys.branches)[keyof typeof queryKeys.branches]>
  | QueryKeyOf<
      (typeof queryKeys.uncommittedFiles)[keyof typeof queryKeys.uncommittedFiles]
    >
  | QueryKeyOf<(typeof queryKeys.problems)[keyof typeof queryKeys.problems]>
  | QueryKeyOf<
      (typeof queryKeys.contextPaths)[keyof typeof queryKeys.contextPaths]
    >
  | QueryKeyOf<(typeof queryKeys.tokenCount)[keyof typeof queryKeys.tokenCount]>
  | QueryKeyOf<(typeof queryKeys.appFiles)[keyof typeof queryKeys.appFiles]>
  | QueryKeyOf<(typeof queryKeys.files)[keyof typeof queryKeys.files]>
  | QueryKeyOf<(typeof queryKeys.appName)[keyof typeof queryKeys.appName]>
  | QueryKeyOf<
      (typeof queryKeys.securityReview)[keyof typeof queryKeys.securityReview]
    >
  | QueryKeyOf<(typeof queryKeys.appTheme)[keyof typeof queryKeys.appTheme]>
  | QueryKeyOf<(typeof queryKeys.themes)[keyof typeof queryKeys.themes]>
  | QueryKeyOf<
      (typeof queryKeys.customThemes)[keyof typeof queryKeys.customThemes]
    >
  | QueryKeyOf<(typeof queryKeys.templates)[keyof typeof queryKeys.templates]>
  | QueryKeyOf<(typeof queryKeys.prompts)[keyof typeof queryKeys.prompts]>
  | QueryKeyOf<(typeof queryKeys.agentTools)[keyof typeof queryKeys.agentTools]>
  | QueryKeyOf<
      (typeof queryKeys.languageModels)[keyof typeof queryKeys.languageModels]
    >
  | QueryKeyOf<(typeof queryKeys.userBudget)[keyof typeof queryKeys.userBudget]>
  | QueryKeyOf<
      (typeof queryKeys.cloudSandboxes)[keyof typeof queryKeys.cloudSandboxes]
    >
  | QueryKeyOf<
      (typeof queryKeys.freeAgentQuota)[keyof typeof queryKeys.freeAgentQuota]
    >
  | QueryKeyOf<(typeof queryKeys.vercel)[keyof typeof queryKeys.vercel]>
  | QueryKeyOf<
      (typeof queryKeys.appUpgrades)[keyof typeof queryKeys.appUpgrades]
    >
  | QueryKeyOf<(typeof queryKeys.mcp)[keyof typeof queryKeys.mcp]>
  | QueryKeyOf<(typeof queryKeys.supabase)[keyof typeof queryKeys.supabase]>
  | QueryKeyOf<(typeof queryKeys.github)[keyof typeof queryKeys.github]>
  | QueryKeyOf<(typeof queryKeys.migration)[keyof typeof queryKeys.migration]>
  | QueryKeyOf<(typeof queryKeys.neon)[keyof typeof queryKeys.neon]>
  | QueryKeyOf<(typeof queryKeys.appEnvVars)[keyof typeof queryKeys.appEnvVars]>
  | QueryKeyOf<(typeof queryKeys.media)[keyof typeof queryKeys.media]>
  | QueryKeyOf<
      (typeof queryKeys.socialMedia)[keyof typeof queryKeys.socialMedia]
    >
  | QueryKeyOf<(typeof queryKeys.helix)[keyof typeof queryKeys.helix]>;
