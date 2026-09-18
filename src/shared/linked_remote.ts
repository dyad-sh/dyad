// Safe to import from both processes: no Electron, no Node.
import { gitLabInstanceLabel } from "./gitlab_instance_url";

/**
 * Which hosting provider an app is linked to.
 *
 * This is the one place that reads `githubOrg`/`githubRepo` and the
 * `gitlab*` columns to decide which provider an app belongs to. It lives in
 * shared/ because both sides need the answer and they must not disagree:
 * the renderer picks a connector and a provider name from it, and
 * src/ipc/utils/app_git_remote.ts builds this into a remote it can
 * authenticate against. A second implementation would mean the UI could name
 * one provider while the push went to the other.
 */

export type LinkedRemoteProvider = "github" | "gitlab";

interface LinkedRemoteBase {
  /** "GitHub", "GitLab", or "GitLab (host)" for a self-hosted instance. */
  providerLabel: string;
  /** `owner/repo` or `group/project`. */
  displayPath: string;
  /** The repository's page in a browser. */
  webUrl: string;
  branch: string | null;
}

export interface LinkedGitHubRemote extends LinkedRemoteBase {
  provider: "github";
  owner: string;
  repo: string;
  /** Always null: GitHub is the only host. Present so callers can read
   * `linked.host` without narrowing first. */
  host: null;
}

export interface LinkedGitLabRemote extends LinkedRemoteBase {
  provider: "gitlab";
  /** The instance URL the project lives on, without a trailing slash. */
  host: string;
  projectId: number;
  projectPath: string;
}

export type LinkedRemote = LinkedGitHubRemote | LinkedGitLabRemote;

export interface LinkedRemoteColumns {
  githubOrg?: string | null;
  githubRepo?: string | null;
  githubBranch?: string | null;
  gitlabHost?: string | null;
  gitlabProjectId?: number | null;
  gitlabProjectPath?: string | null;
  gitlabBranch?: string | null;
}

/** "GitLab" for gitlab.com, the instance's host for anything self-hosted. */
export function gitLabProviderLabel(host: string): string {
  const label = gitLabInstanceLabel(host);
  return label === "gitlab.com" ? "GitLab" : `GitLab (${label})`;
}

export function describeLinkedRemote(
  app: LinkedRemoteColumns | null | undefined,
): LinkedRemote | null {
  if (!app) return null;
  if (app.githubOrg && app.githubRepo) {
    return {
      provider: "github",
      providerLabel: "GitHub",
      owner: app.githubOrg,
      repo: app.githubRepo,
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
    const host = app.gitlabHost.replace(/\/+$/, "");
    return {
      provider: "gitlab",
      providerLabel: gitLabProviderLabel(host),
      host,
      projectId: app.gitlabProjectId,
      projectPath: app.gitlabProjectPath,
      displayPath: app.gitlabProjectPath,
      webUrl: `${host}/${app.gitlabProjectPath}`,
      branch: app.gitlabBranch ?? null,
    };
  }
  return null;
}
