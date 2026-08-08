import type { UserSettings } from "./schemas";

export function hasEnabledDevOpsPlugins(
  settings:
    | Pick<UserSettings, "githubAccessToken" | "vercelAccessToken">
    | null
    | undefined,
): boolean {
  return Boolean(
    settings?.githubAccessToken?.value || settings?.vercelAccessToken?.value,
  );
}
