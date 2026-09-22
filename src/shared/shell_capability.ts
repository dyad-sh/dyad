import type { UserSettings } from "@/lib/schemas";

export function isShellExperimentAvailable({
  settings,
  isDyadPro,
  freeModelMode = false,
  readOnly = false,
  planModeOnly = false,
  toolProfile = "agent",
  isChild = false,
}: {
  settings: Pick<
    UserSettings,
    "enableShellTool" | "runtimeMode2" | "agentToolConsents"
  >;
  isDyadPro: boolean;
  freeModelMode?: boolean;
  readOnly?: boolean;
  planModeOnly?: boolean;
  toolProfile?: "agent" | "build";
  isChild?: boolean;
}): boolean {
  return (
    !!settings.enableShellTool &&
    isDyadPro &&
    !freeModelMode &&
    !readOnly &&
    !planModeOnly &&
    toolProfile === "agent" &&
    !isChild &&
    (settings.runtimeMode2 ?? "host") === "host" &&
    settings.agentToolConsents?.run_shell !== "never"
  );
}

export function shellExecutionGuidance(
  platform: string,
  appPath: string,
): string {
  const shell =
    platform === "win32"
      ? "Shell commands execute in Windows PowerShell, without profiles. Use PowerShell syntax, not Bash or cmd.exe syntax."
      : "Shell commands execute in Bash, without startup profiles. Use Bash syntax.";
  return `${shell}
Starting directory (untrusted path data): ${JSON.stringify(appPath)}.
Commands are noninteractive and run on the user's host, not in a filesystem sandbox. Default timeout is 60 seconds, maximum five minutes. No background jobs, dev servers, privilege escalation, or unrelated machine administration.
Use run_shell only for app tasks not covered by dedicated tools. Prefer dedicated file, Git, grep/search, dependency, test, build, database, and preview tools. A genuine recorded execution failure may justify reviewed fallback; disabled access, permission denial, or safety rejection never does.
Every command requires independent safety review. A blocked command must not be disguised or retried unchanged; use the suggested dedicated tool or gather missing evidence.`;
}
