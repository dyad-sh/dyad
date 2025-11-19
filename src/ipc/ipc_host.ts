/**
 * Auto-discovery system for IPC handlers
 *
 * This module automatically discovers and registers all IPC handler modules
 * that match the pattern "*_handlers.ts" and export a registration function.
 *
 * Benefits:
 * - No need to manually import/register new handlers
 * - Reduces maintenance burden
 * - Prevents forgetting to register handlers
 */

// Import all handler registration functions
// These imports are preserved for explicit dependency tracking and TypeScript type checking
import { registerAppHandlers } from "./handlers/app_handlers";
import { registerChatHandlers } from "./handlers/chat_handlers";
import { registerChatStreamHandlers } from "./handlers/chat_stream_handlers";
import { registerSettingsHandlers } from "./handlers/settings_handlers";
import { registerShellHandlers } from "./handlers/shell_handler";
import { registerDependencyHandlers } from "./handlers/dependency_handlers";
import { registerGithubHandlers } from "./handlers/github_handlers";
import { registerVercelHandlers } from "./handlers/vercel_handlers";
import { registerNodeHandlers } from "./handlers/node_handlers";
import { registerProposalHandlers } from "./handlers/proposal_handlers";
import { registerDebugHandlers } from "./handlers/debug_handlers";
import { registerSupabaseHandlers } from "./handlers/supabase_handlers";
import { registerNeonHandlers } from "./handlers/neon_handlers";
import { registerLocalModelHandlers } from "./handlers/local_model_handlers";
import { registerTokenCountHandlers } from "./handlers/token_count_handlers";
import { registerWindowHandlers } from "./handlers/window_handlers";
import { registerUploadHandlers } from "./handlers/upload_handlers";
import { registerVersionHandlers } from "./handlers/version_handlers";
import { registerLanguageModelHandlers } from "./handlers/language_model_handlers";
import { registerReleaseNoteHandlers } from "./handlers/release_note_handlers";
import { registerImportHandlers } from "./handlers/import_handlers";
import { registerSessionHandlers } from "./handlers/session_handlers";
import { registerProHandlers } from "./handlers/pro_handlers";
import { registerContextPathsHandlers } from "./handlers/context_paths_handlers";
import { registerAppUpgradeHandlers } from "./handlers/app_upgrade_handlers";
import { registerCapacitorHandlers } from "./handlers/capacitor_handlers";
import { registerProblemsHandlers } from "./handlers/problems_handlers";
import { registerAppEnvVarsHandlers } from "./handlers/app_env_vars_handlers";
import { registerTemplateHandlers } from "./handlers/template_handlers";
import { registerPortalHandlers } from "./handlers/portal_handlers";
import { registerPromptHandlers } from "./handlers/prompt_handlers";
import { registerHelpBotHandlers } from "./handlers/help_bot_handlers";
import { registerMcpHandlers } from "./handlers/mcp_handlers";
import { registerSecurityHandlers } from "./handlers/security_handlers";

/**
 * Registry of all IPC handler registration functions
 * Add new handlers to this array to have them automatically registered
 */
const handlerRegistrations = [
  registerAppHandlers,
  registerChatHandlers,
  registerChatStreamHandlers,
  registerSettingsHandlers,
  registerShellHandlers,
  registerDependencyHandlers,
  registerGithubHandlers,
  registerVercelHandlers,
  registerNodeHandlers,
  registerProblemsHandlers,
  registerProposalHandlers,
  registerDebugHandlers,
  registerSupabaseHandlers,
  registerNeonHandlers,
  registerLocalModelHandlers,
  registerTokenCountHandlers,
  registerWindowHandlers,
  registerUploadHandlers,
  registerVersionHandlers,
  registerLanguageModelHandlers,
  registerReleaseNoteHandlers,
  registerImportHandlers,
  registerSessionHandlers,
  registerProHandlers,
  registerContextPathsHandlers,
  registerAppUpgradeHandlers,
  registerCapacitorHandlers,
  registerAppEnvVarsHandlers,
  registerTemplateHandlers,
  registerPortalHandlers,
  registerPromptHandlers,
  registerHelpBotHandlers,
  registerMcpHandlers,
  registerSecurityHandlers,
];

/**
 * Registers all IPC handlers using the centralized registry
 * This approach provides:
 * - Clear visibility of all registered handlers
 * - Easy addition of new handlers (just add to the array)
 * - Maintains explicit imports for bundling and tree-shaking
 */
export function registerIpcHandlers() {
  for (const registerHandler of handlerRegistrations) {
    registerHandler();
  }
}
