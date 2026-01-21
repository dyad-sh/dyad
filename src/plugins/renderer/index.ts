/**
 * Plugin Renderer-side Exports
 *
 * This module exports utilities and hooks for using plugins in React components.
 */

// Generic plugin hooks
export {
  pluginQueryKey,
  usePluginQuery,
  usePluginMutation,
  type UsePluginQueryOptions,
  type UsePluginMutationOptions,
} from "./hooks/usePlugin";

// Supabase-specific hook
export {
  useSupabasePlugin,
  type UseSupabasePluginOptions,
  type SupabaseOrganization,
  type SupabaseProject,
  type SupabaseBranch,
  type ConsoleEntry,
} from "./hooks/useSupabasePlugin";
