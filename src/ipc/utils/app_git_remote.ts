import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import {
  gitLabInstanceLabel,
  normalizeGitLabInstanceUrl,
} from "@/shared/gitlab_instance_url";
import type { GitRemoteAuth } from "../git_types";
import { getGitHubGitBase, GITHUB_SSH_HOST } from "./github_endpoints";
import { GitLabClient } from "./gitlab_client";

/**
 * The one place that answers "which git hosting provider is this app linked
 * to, and how do we talk to it".
 *
 * Push, pull, fetch, the Publish panel gates and the Coolify deploy all used
 * to read `githubOrg`/`githubRepo` straight off the app row and build GitHub
 * URLs inline. Routing them through here means a second provider is a new
 * branch in this module rather than a new `if` in every consumer.
 */

export type GitRemoteProvider = "github" | "gitlab";

export interface GitHubRemote {
  provider: "github";
  /** Name to use in messages: "GitHub". */
  providerLabel: string;
  owner: string;
  repo: string;
  branch: string;
  /** What a user recognises the repository by, e.g. `owner/repo`. */
  displayPath: string;
  /** Credential-free HTTPS URL for clone, fetch and push. */
  httpsUrl: string;
  /** SSH URL a third party clones with (Coolify, via a deploy key). */
  sshUrl: string;
}

export interface GitLabRemote {
  provider: "gitlab";
  /** Name to use in messages: "GitLab", or the instance for self-hosted. */
  providerLabel: string;
  /** Normalized instance URL the project lives on, e.g. `https://gitlab.com`. */
  host: string;
  projectId: number;
  /** `namespace/path`, what a user recognises the project by. */
  projectPath: string;
  branch: string;
  displayPath: string;
  /** Credential-free HTTPS URL for clone, fetch and push. */
  httpsUrl: string;
  /**
   * No SSH URL here: self-hosted instances often serve SSH on another port,
   * and only the project's API record knows it. Coolify asks GitLab at deploy
   * time instead of guessing.
   */
}

export type AppGitRemote = GitHubRemote | GitLabRemote;

/** The app columns the resolver reads. A subset so callers can pass a row or a DTO. */
export interface AppGitRemoteColumns {
  githubOrg?: string | null;
  githubRepo?: string | null;
  githubBranch?: string | null;
  gitlabHost?: string | null;
  gitlabProjectId?: number | null;
  gitlabProjectPath?: string | null;
  gitlabBranch?: string | null;
}

export function githubRemote({
  owner,
  repo,
  branch,
}: {
  owner: string;
  repo: string;
  branch?: string | null;
}): GitHubRemote {
  return {
    provider: "github",
    providerLabel: "GitHub",
    owner,
    repo,
    branch: branch || "main",
    displayPath: `${owner}/${repo}`,
    httpsUrl: `${getGitHubGitBase()}/${owner}/${repo}.git`,
    sshUrl: `git@${GITHUB_SSH_HOST}:${owner}/${repo}.git`,
  };
}

export function gitlabRemote({
  host,
  projectId,
  projectPath,
  branch,
}: {
  host: string;
  projectId: number;
  projectPath: string;
  branch?: string | null;
}): GitLabRemote {
  const normalizedHost = normalizeGitLabInstanceUrl(host);
  return {
    provider: "gitlab",
    providerLabel: gitLabProviderLabel(normalizedHost),
    host: normalizedHost,
    projectId,
    projectPath,
    branch: branch || "main",
    displayPath: projectPath,
    httpsUrl: `${normalizedHost}/${projectPath}.git`,
  };
}

/** "GitLab" for gitlab.com, the instance's host for anything self-hosted. */
export function gitLabProviderLabel(host: string): string {
  const label = gitLabInstanceLabel(host);
  return label === "gitlab.com" ? "GitLab" : `GitLab (${label})`;
}

/** The remote an app is linked to, or null when it is not linked to any. */
export function resolveAppGitRemote(
  app: AppGitRemoteColumns,
): AppGitRemote | null {
  if (app.githubOrg && app.githubRepo) {
    return githubRemote({
      owner: app.githubOrg,
      repo: app.githubRepo,
      branch: app.githubBranch,
    });
  }
  if (
    app.gitlabHost &&
    app.gitlabProjectId !== null &&
    app.gitlabProjectId !== undefined &&
    app.gitlabProjectPath
  ) {
    return gitlabRemote({
      host: app.gitlabHost,
      projectId: app.gitlabProjectId,
      projectPath: app.gitlabProjectPath,
      branch: app.gitlabBranch,
    });
  }
  return null;
}

export function hasAppGitRemote(app: AppGitRemoteColumns): boolean {
  return resolveAppGitRemote(app) !== null;
}

/**
 * The remote an app is linked to, or a Precondition error. The message is
 * the one the GitHub handlers have always thrown for an unlinked app, so
 * nothing downstream that matches on it changes.
 */
export function requireAppGitRemote(app: AppGitRemoteColumns): AppGitRemote {
  const remote = resolveAppGitRemote(app);
  if (!remote) {
    throw new DyadError(
      "App is not linked to a GitHub repo.",
      DyadErrorKind.Precondition,
    );
  }
  return remote;
}

/**
 * An app links to one provider at a time. Refuses to link `provider` while
 * another one is linked, so the UI's exclusivity is not the only guard.
 */
export function assertCanLinkProvider(
  app: AppGitRemoteColumns,
  provider: GitRemoteProvider,
): void {
  const current = resolveAppGitRemote(app);
  if (current && current.provider !== provider) {
    const target = provider === "github" ? "GitHub" : "GitLab";
    throw new DyadError(
      `This app is already linked to ${current.providerLabel} (${current.displayPath}). ` +
        `Disconnect it before linking a ${target} repository.`,
      DyadErrorKind.Precondition,
    );
  }
}

/**
 * Credentials for git network operations against the remote's host.
 *
 * Throws an Auth error when the provider is not connected, and a
 * Precondition error when the GitLab connection points at a different
 * instance than the app was linked on — pushing there would go to the wrong
 * GitLab, silently.
 */
export function getAppGitRemoteAuth(remote: AppGitRemote): GitRemoteAuth {
  switch (remote.provider) {
    case "github": {
      const auth = getGitHubRemoteAuth();
      if (!auth) {
        throw new DyadError(
          "Not authenticated with GitHub.",
          DyadErrorKind.Auth,
        );
      }
      return auth;
    }
    case "gitlab":
      return gitlabRemoteAuth(remote.host, requireGitLabToken(remote));
  }
}

/**
 * The stored GitLab token, provided the connection points at the instance
 * the app was linked on.
 */
function requireGitLabToken(remote: GitLabRemote): string {
  const gitlab = readSettings().gitlab;
  const token = gitlab?.accessToken?.value;
  if (!token || !gitlab?.instanceUrl) {
    throw new DyadError("Not authenticated with GitLab.", DyadErrorKind.Auth);
  }
  const connectedHost = normalizeGitLabInstanceUrl(gitlab.instanceUrl);
  if (connectedHost !== remote.host) {
    throw new DyadError(
      `This app is linked to ${remote.displayPath} on ${gitLabInstanceLabel(remote.host)}, ` +
        `but Dyad is connected to ${gitLabInstanceLabel(connectedHost)}. ` +
        `Connect to ${gitLabInstanceLabel(remote.host)} to sync this app.`,
      DyadErrorKind.Precondition,
    );
  }
  return token;
}

/** An API client for the instance a GitLab-linked app lives on. */
export function getGitLabClientForRemote(
  remote: GitLabRemote,
  signal?: AbortSignal,
): GitLabClient {
  return new GitLabClient({
    instanceUrl: remote.host,
    token: requireGitLabToken(remote),
    signal,
  });
}

/** GitHub credentials in the shape git needs, or null when not connected. */
export function getGitHubRemoteAuth(): GitRemoteAuth | null {
  const accessToken = readSettings().githubAccessToken?.value;
  if (!accessToken) return null;
  return githubRemoteAuth(accessToken);
}

export function githubRemoteAuth(accessToken: string): GitRemoteAuth {
  // GitHub accepts the token as the basic-auth user with a fixed password.
  return {
    hostUrl: getGitHubGitBase(),
    username: accessToken,
    password: "x-oauth-basic",
  };
}

export function gitlabRemoteAuth(
  host: string,
  accessToken: string,
): GitRemoteAuth {
  // GitLab takes a personal access token as the password of a fixed user.
  return {
    hostUrl: normalizeGitLabInstanceUrl(host),
    username: "oauth2",
    password: accessToken,
  };
}
