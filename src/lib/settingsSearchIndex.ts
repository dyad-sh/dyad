export type SearchableSettingItem = {
  id: string;
  label: string;
  description: string;
  keywords: string[];
  sectionId: string;
  sectionLabel: string;
};

export const SETTINGS_SEARCH_INDEX: SearchableSettingItem[] = [
  // General Settings
  {
    id: "setting-theme",
    label: "Theme",
    description: "Switch between system, light, and dark mode",
    keywords: ["dark mode", "light mode", "appearance", "color", "system"],
    sectionId: "general-settings",
    sectionLabel: "General",
  },
  {
    id: "setting-zoom",
    label: "Zoom Level",
    description: "Adjust the zoom level to make content easier to read",
    keywords: ["font size", "magnify", "scale", "accessibility", "zoom"],
    sectionId: "general-settings",
    sectionLabel: "General",
  },
  {
    id: "setting-auto-update",
    label: "Auto Update",
    description: "Automatically update the app when new versions are available",
    keywords: ["update", "automatic", "version", "upgrade"],
    sectionId: "general-settings",
    sectionLabel: "General",
  },
  {
    id: "setting-release-channel",
    label: "Release Channel",
    description: "Choose between stable and beta release channels",
    keywords: ["stable", "beta", "channel", "release", "version"],
    sectionId: "general-settings",
    sectionLabel: "General",
  },
  {
    id: "setting-runtime-mode",
    label: "Runtime Mode",
    description: "Configure Node runtime settings",
    keywords: ["node", "runtime", "bun", "environment"],
    sectionId: "general-settings",
    sectionLabel: "General",
  },
  {
    id: "setting-node-path",
    label: "Node Path",
    description: "Set a custom Node.js installation path",
    keywords: ["node", "path", "nodejs", "binary", "executable"],
    sectionId: "general-settings",
    sectionLabel: "General",
  },

  // Workflow Settings
  {
    id: "setting-default-chat-mode",
    label: "Default Chat Mode",
    description: "Choose the default mode for new chats",
    keywords: ["chat", "mode", "build", "agent", "mcp", "default"],
    sectionId: "workflow-settings",
    sectionLabel: "Workflow",
  },
  {
    id: "setting-auto-approve",
    label: "Auto-approve",
    description: "Automatically approve code changes and run them",
    keywords: ["approve", "automatic", "code changes", "auto"],
    sectionId: "workflow-settings",
    sectionLabel: "Workflow",
  },
  {
    id: "setting-auto-fix",
    label: "Auto Fix Problems",
    description: "Automatically fix TypeScript errors",
    keywords: ["fix", "typescript", "errors", "automatic", "problems", "auto"],
    sectionId: "workflow-settings",
    sectionLabel: "Workflow",
  },
  {
    id: "setting-auto-expand-preview",
    label: "Auto Expand Preview",
    description:
      "Automatically expand the preview panel when code changes are made",
    keywords: ["preview", "expand", "panel", "automatic", "auto"],
    sectionId: "workflow-settings",
    sectionLabel: "Workflow",
  },

  // AI Settings
  {
    id: "setting-thinking-budget",
    label: "Thinking Budget",
    description: "Set the AI thinking token budget",
    keywords: ["thinking", "tokens", "budget", "reasoning", "ai"],
    sectionId: "ai-settings",
    sectionLabel: "AI",
  },
  {
    id: "setting-max-chat-turns",
    label: "Max Chat Turns",
    description: "Set the maximum number of conversation turns",
    keywords: ["turns", "max", "conversation", "limit", "chat"],
    sectionId: "ai-settings",
    sectionLabel: "AI",
  },

  // Provider Settings
  {
    id: "provider-settings",
    label: "Model Providers",
    description: "Configure AI model providers and API keys",
    keywords: [
      "provider",
      "model",
      "api key",
      "openai",
      "anthropic",
      "claude",
      "gpt",
      "gemini",
      "llm",
    ],
    sectionId: "provider-settings",
    sectionLabel: "Model Providers",
  },

  // Telemetry
  {
    id: "setting-telemetry",
    label: "Telemetry",
    description: "Enable or disable anonymous usage data collection",
    keywords: [
      "telemetry",
      "analytics",
      "usage",
      "data",
      "privacy",
      "tracking",
    ],
    sectionId: "telemetry",
    sectionLabel: "Telemetry",
  },

  // Integrations
  {
    id: "setting-github",
    label: "GitHub Integration",
    description: "Connect your GitHub account",
    keywords: ["github", "git", "integration", "connect", "account"],
    sectionId: "integrations",
    sectionLabel: "Integrations",
  },
  {
    id: "setting-vercel",
    label: "Vercel Integration",
    description: "Connect your Vercel account for deployments",
    keywords: ["vercel", "deploy", "integration", "hosting", "connect"],
    sectionId: "integrations",
    sectionLabel: "Integrations",
  },
  {
    id: "setting-supabase",
    label: "Supabase Integration",
    description: "Connect your Supabase project",
    keywords: [
      "supabase",
      "database",
      "integration",
      "backend",
      "connect",
      "postgres",
    ],
    sectionId: "integrations",
    sectionLabel: "Integrations",
  },
  {
    id: "setting-neon",
    label: "Neon Integration",
    description: "Connect your Neon database",
    keywords: [
      "neon",
      "database",
      "integration",
      "postgres",
      "connect",
      "serverless",
    ],
    sectionId: "integrations",
    sectionLabel: "Integrations",
  },

  // Agent Permissions
  {
    id: "agent-permissions",
    label: "Agent Permissions",
    description: "Configure permissions for agent built-in tools",
    keywords: [
      "agent",
      "permissions",
      "tools",
      "approve",
      "allow",
      "consent",
      "pro",
    ],
    sectionId: "agent-permissions",
    sectionLabel: "Agent Permissions",
  },

  // Tools (MCP)
  {
    id: "tools-mcp",
    label: "Tools (MCP)",
    description: "Configure MCP servers and environment variables",
    keywords: [
      "mcp",
      "tools",
      "server",
      "model context protocol",
      "environment",
    ],
    sectionId: "tools-mcp",
    sectionLabel: "Tools (MCP)",
  },

  // Experiments
  {
    id: "setting-native-git",
    label: "Enable Native Git",
    description:
      "Use native Git for faster performance without external installation",
    keywords: ["git", "native", "experiment", "beta", "performance"],
    sectionId: "experiments",
    sectionLabel: "Experiments",
  },

  // Danger Zone
  {
    id: "setting-reset",
    label: "Reset Everything",
    description:
      "Delete all apps, chats, and settings. This action cannot be undone.",
    keywords: ["reset", "delete", "clear", "wipe", "danger", "destructive"],
    sectionId: "danger-zone",
    sectionLabel: "Danger Zone",
  },
];
