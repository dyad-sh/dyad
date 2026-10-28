import type { GitLabConnectionDiagnostics } from "../ipc/types/gitlab";

/** Only this support build opts out of auto-update; saved preferences stay intact. */
export const GITLAB_DIAGNOSTIC_VERSION = "1.22.0-alpha.1";

export function formatGitLabConnectionDiagnostics(
  report: GitLabConnectionDiagnostics,
): string {
  return [
    "GitLab connection diagnostics (no token or cookies sent)",
    `Dyad: ${report.appVersion}`,
    `Electron: ${report.electronVersion}; Node: ${report.nodeVersion}`,
    `Platform: ${report.platform} ${report.arch}`,
    `Tested: ${report.testedAt}`,
    `URL: ${report.url}`,
    "Any HTTP response proves transport connectivity; 401 is expected without a token.",
    "Redirects are reported without following them. This does not validate GitLab authentication.",
    ...report.results.map((result) =>
      result.httpStatus !== null
        ? `${result.transport}: CONNECTED — HTTP ${result.httpStatus} (${result.durationMs} ms)`
        : `${result.transport}: FAILED (${result.durationMs} ms)\n${result.error}`,
    ),
  ].join("\n");
}
