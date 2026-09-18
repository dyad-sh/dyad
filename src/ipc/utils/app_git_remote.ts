import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import {
  gitLabInstanceLabel,
  normalizeGitLabInstanceUrl,
} from "@/shared/gitlab_instance_url";
import {
  describeLinkedRemote,
  gitLabProviderLabel,
  type LinkedRemoteColumns,
} from "@/shared/linked_remote";
import type { GitRemoteAuth } from "../git_types";
import { getGitHubGitBase, GITHUB_SSH_HOST } from "./github_endpoints";
import { GitLabClient } from "./gitlab_client";

/**
 * How the main process talks to the provider an app is linked to.
 *
 * Push, pull, fetch, the Publish panel gates and the Coolify deploy all used
 * to read `githubOrg`/`githubRepo` straight off the app row and build GitHub
 * URLs inline. Routing them through here means a second provider is a new
 * branch in this module rather than a new `if` in every consumer.
 *
 * Which provider an app belongs to is decided once, in
 * src/shared/linked_remote.ts, so the renderer and this module cannot
 * disagree. This module adds what only the main process needs: URLs and
 * credentials.
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
export type AppGitRemoteColumns = LinkedRemoteColumns;

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

/** The remote an app is linked to, or null when it is not linked to any. */
export function resolveAppGitRemote(
  app: AppGitRemoteColumns,
): AppGitRemote | null {
  const linked = describeLinkedRemote(app);
  if (!linked) return null;
  if (linked.provider === "github") {
    return githubRemote({
      owner: linked.owner,
      repo: linked.repo,
      branch: linked.branch,
    });
  }
  return gitlabRemote({
    host: linked.host,
    projectId: linked.projectId,
    projectPath: linked.projectPath,
    branch: linked.branch,
  });
}

/**
 * The remote an app is linked to, or a Precondition error.
 *
 * The message names no provider: this fires on the ordinary "not linked yet"
 * case for every sync action, and a GitLab user being told about a GitHub
 * repo was the most likely first error message they would see.
 */
export function requireAppGitRemote(app: AppGitRemoteColumns): AppGitRemote {
  const remote = resolveAppGitRemote(app);
  if (!remote) {
    throw new DyadError(
      "App is not linked to a repository.",
      DyadErrorKind.Precondition,
    );
  }
  return remote;
}

/**
 * Refuses an operation whose provider disagrees with the app's linked remote.
 *
 * The provider travels from the renderer, which reads it off the app row —
 * but a window holding a stale row can name one that no longer matches, and
 * the machine composes its banners and follow-up operations from what it was
 * given. The operation itself always uses the remote resolved here, so the
 * disagreement would show up as a success banner naming a provider the push
 * never touched.
 */
export function assertRemoteProvider(
  remote: AppGitRemote,
  provider: GitRemoteProvider | undefined,
): void {
  if (!provider || remote.provider === provider) return;
  throw new DyadError(
    `This app is linked to ${remote.providerLabel}, but the request named ` +
      `${provider === "gitlab" ? "GitLab" : "GitHub"}. Reopen the app and try again.`,
    DyadErrorKind.Precondition,
  );
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
