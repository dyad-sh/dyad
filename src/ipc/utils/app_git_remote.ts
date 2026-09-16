import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { readSettings } from "@/main/settings";
import type { GitRemoteAuth } from "../git_types";
import { getGitHubGitBase, GITHUB_SSH_HOST } from "./github_endpoints";

/**
 * The one place that answers "which git hosting provider is this app linked
 * to, and how do we talk to it".
 *
 * Push, pull, fetch, the Publish panel gates and the Coolify deploy all used
 * to read `githubOrg`/`githubRepo` straight off the app row and build GitHub
 * URLs inline. Routing them through here means a second provider is a new
 * branch in this module rather than a new `if` in every consumer.
 */

export type GitRemoteProvider = "github";

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

export type AppGitRemote = GitHubRemote;

/** The app columns the resolver reads. A subset so callers can pass a row or a DTO. */
export interface AppGitRemoteColumns {
  githubOrg?: string | null;
  githubRepo?: string | null;
  githubBranch?: string | null;
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
  return null;
}

export function hasAppGitRemote(app: AppGitRemoteColumns): boolean {
  return resolveAppGitRemote(app) !== null;
}

/**
 * The remote an app is linked to, or a Precondition error naming the provider
 * the caller expected. The message matches what the GitHub handlers have
 * always thrown, so nothing downstream that matches on it changes.
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
 * Credentials for git network operations against the remote's host.
 *
 * Throws an Auth error when the provider is not connected; the message is
 * the one the handlers have always shown for a missing token.
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
  }
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
