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
Commands are noninteractive and run on the user's host, not in a filesystem sandbox. Default timeout is 60 seconds, maximum five minutes. No background jobs, dev servers, privilege escalation, or unrelated machine administration. App-related cloud troubleshooting and administration using CLIs such as gcloud are in scope.
Use run_shell only for app tasks not covered by a dedicated tool that supports the actual operation, target, and required options. Local preview logs do not substitute for cloud logs. Prefer dedicated file, Git, grep/search, dependency, test, build, database, and preview tools. A genuine recorded execution failure may justify reviewed fallback; disabled access, permission denial, or safety rejection never does.
Every command requires independent safety review. Routine reads and bounded reversible work can be allowed automatically. Consequential actions lacking sufficient authorization require one-time approval of the exact command; saved always consent cannot bypass it. Clear policy violations remain blocked. Review unavailability permits retry of the safety check, never execution without a verdict. A blocked command must not be disguised or retried unchanged; use the suggested dedicated tool or gather missing evidence.`;
}
