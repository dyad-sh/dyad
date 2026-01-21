/**
 * Supabase Plugin
 *
 * This plugin provides Supabase integration for Dyad apps, including:
 * - OAuth authentication with multi-organization support
 * - Database operations (SQL execution, schema queries)
 * - Edge function deployment and logging
 * - AI agent context and tools
 * - System prompts for the AI
 */

import type { PluginDefinition } from "../types";
import { createOAuthCapability } from "./capabilities/oauth";
import { createDatabaseCapability } from "./capabilities/database";
import { createFunctionsCapability } from "./capabilities/functions";
import { createAgentContextCapability } from "./capabilities/agent_context";
import { createAgentToolsCapability } from "./capabilities/agent_tools";
import { createPromptsCapability } from "./capabilities/prompts";
import { createSupabaseIpcHandlers } from "./ipc_handlers";

export const SUPABASE_PLUGIN_ID = "supabase" as const;

/**
 * Supabase plugin definition.
 */
export const supabasePlugin: PluginDefinition = {
  metadata: {
    id: SUPABASE_PLUGIN_ID,
    displayName: "Supabase",
    description:
      "Backend-as-a-Service with PostgreSQL database, authentication, edge functions, and real-time subscriptions",
    version: "1.0.0",
    category: "database",
    icon: "supabase",
    docsUrl: "https://dyad.sh/docs/integrations/supabase",
    enabledByDefault: true,
  },

  capabilities: {
    oauth: createOAuthCapability(),
    database: createDatabaseCapability(),
    functions: createFunctionsCapability(),
    agentContext: createAgentContextCapability(),
    agentTools: createAgentToolsCapability(),
    prompts: createPromptsCapability(),
  },

  ipcHandlers: createSupabaseIpcHandlers(),

  lifecycle: {
    onLoad: async () => {
      // Plugin loaded - no initialization needed currently
    },
    onUnload: async () => {
      // Plugin unloaded - cleanup if needed
    },
  },
};

// Re-export for convenience
export * from "./capabilities/oauth";
export * from "./capabilities/database";
export * from "./capabilities/functions";
export * from "./capabilities/agent_context";
export * from "./capabilities/agent_tools";
export * from "./capabilities/prompts";
