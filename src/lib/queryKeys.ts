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

  // ─────────────────────────────────────────────────────────────────────────────
  // Apps
  // ─────────────────────────────────────────────────────────────────────────────
  apps: {
    all: ["apps"] as const,
    detail: ({ appId }: { appId: number | null }) =>
      ["apps", "detail", appId] as const,
    search: ({ query }: { query: string }) =>
      ["apps", "search", query] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Chats
  // ─────────────────────────────────────────────────────────────────────────────
  chats: {
    all: ["chats"] as const,
    list: ({ appId }: { appId: number | null }) => ["chats", appId] as const,
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
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // User Budget
  // ─────────────────────────────────────────────────────────────────────────────
  userBudget: {
    info: ["userBudgetInfo"] as const,
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
    all: ["vercel-deployments"] as const,
    deployments: ({ appId }: { appId: number }) =>
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
    toolsByServer: {
      all: ["mcp", "tools-by-server"] as const,
      list: ({ serverIds }: { serverIds: number[] }) =>
        ["mcp", "tools-by-server", serverIds] as const,
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
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // GitHub
  // ─────────────────────────────────────────────────────────────────────────────
  github: {
    all: ["github"] as const,
    repos: ["github", "repos"] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // Neon
  // ─────────────────────────────────────────────────────────────────────────────
  neon: {
    project: ({ appId }: { appId: number | null }) =>
      ["neon-project", appId] as const,
  },

  // ─────────────────────────────────────────────────────────────────────────────
  // App Environment Variables
  // ─────────────────────────────────────────────────────────────────────────────
  appEnvVars: {
    byApp: ({ appId }: { appId: number | null }) =>
      ["app-env-vars", appId] as const,
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
      (typeof queryKeys.freeAgentQuota)[keyof typeof queryKeys.freeAgentQuota]
    >
  | QueryKeyOf<(typeof queryKeys.vercel)[keyof typeof queryKeys.vercel]>
  | QueryKeyOf<
      (typeof queryKeys.appUpgrades)[keyof typeof queryKeys.appUpgrades]
    >
  | QueryKeyOf<(typeof queryKeys.mcp)[keyof typeof queryKeys.mcp]>
  | QueryKeyOf<(typeof queryKeys.supabase)[keyof typeof queryKeys.supabase]>
  | QueryKeyOf<(typeof queryKeys.github)[keyof typeof queryKeys.github]>
  | QueryKeyOf<(typeof queryKeys.neon)[keyof typeof queryKeys.neon]>
  | QueryKeyOf<
      (typeof queryKeys.appEnvVars)[keyof typeof queryKeys.appEnvVars]
    >;
