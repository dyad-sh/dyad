// Safe to import from both processes: no Electron, no Node.
import { gitLabInstanceLabel } from "./gitlab_instance_url";

/**
 * Which hosting provider an app is linked to, as the renderer sees it.
 *
 * The main process has src/ipc/utils/app_git_remote.ts, which also knows how
 * to authenticate; this is the part of that answer a component may hold:
 * enough to pick the right connector, name the provider and link to the
 * repository page.
 */

export type LinkedRemoteProvider = "github" | "gitlab";

export interface LinkedRemote {
  provider: LinkedRemoteProvider;
  /** "GitHub", "GitLab", or "GitLab (host)" for a self-hosted instance. */
  providerLabel: string;
  /** `owner/repo` or `group/project`. */
  displayPath: string;
  /** The repository's page in a browser. */
  webUrl: string;
  branch: string | null;
  /** The normalized instance URL for GitLab; null for GitHub. */
  host: string | null;
}

export interface LinkedRemoteColumns {
  githubOrg?: string | null;
  githubRepo?: string | null;
  githubBranch?: string | null;
  gitlabHost?: string | null;
  gitlabProjectId?: number | null;
  gitlabProjectPath?: string | null;
  gitlabBranch?: string | null;
}

export function describeLinkedRemote(
  app: LinkedRemoteColumns | null | undefined,
): LinkedRemote | null {
  if (!app) return null;
  if (app.githubOrg && app.githubRepo) {
    return {
      provider: "github",
      providerLabel: "GitHub",
      displayPath: `${app.githubOrg}/${app.githubRepo}`,
      webUrl: `https://github.com/${app.githubOrg}/${app.githubRepo}`,
      branch: app.githubBranch ?? null,
      host: null,
    };
  }
  if (
    app.gitlabHost &&
    app.gitlabProjectId !== null &&
    app.gitlabProjectId !== undefined &&
    app.gitlabProjectPath
  ) {
    const label = gitLabInstanceLabel(app.gitlabHost);
    return {
      provider: "gitlab",
      providerLabel: label === "gitlab.com" ? "GitLab" : `GitLab (${label})`,
      displayPath: app.gitlabProjectPath,
      webUrl: `${app.gitlabHost.replace(/\/+$/, "")}/${app.gitlabProjectPath}`,
      branch: app.gitlabBranch ?? null,
      host: app.gitlabHost,
    };
  }
  return null;
}
