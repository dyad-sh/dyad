import { readSettings } from "../../main/settings";

/**
 * Whether the app-specific plugin configurations experiment is on. The one
 * place that reads the setting, so the connection, consent and chat paths
 * can't disagree about it.
 */
export function isAppScopedPluginsEnabled(): boolean {
  return !!readSettings().enableAppScopedPlugins;
}
