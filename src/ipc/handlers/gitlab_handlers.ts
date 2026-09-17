import { eq } from "drizzle-orm";
import log from "electron-log";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { readSettings, writeSettings } from "../../main/settings";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { forgottenGitLab } from "@/lib/schemas";
import { slugifyAppPath } from "@/shared/slugify";
import {
  gitLabInstanceLabel,
  normalizeGitLabInstanceUrl,
} from "@/shared/gitlab_instance_url";
import { createTypedHandler } from "./base";
import { gitlabContracts, type GitLabStatus } from "../types/gitlab";
import { isSecureInstanceUrl } from "../types/coolify";
import {
  GitLabClient,
  GITLAB_REQUIRED_SCOPE,
  isGitLabStatus,
  type GitLabNamespace,
  type GitLabProject,
} from "../utils/gitlab_client";
import {
  assertCanLinkProvider,
  gitlabRemote,
  gitlabRemoteAuth,
} from "../utils/app_git_remote";
import { findAppOrThrow } from "../utils/find_app";
import { prepareLocalBranch } from "./github_handlers";

const logger = log.scope("gitlab_handlers");

/**
 * Normalizes a project name the way GitLab would derive its path: a
 * kebab-case slug, the same one the app folder and a GitHub repo name use.
 */
export function normalizeGitLabProjectPath(name: string): string {
  return slugifyAppPath(name);
}

function readStatus(): GitLabStatus {
  const gitlab = readSettings().gitlab;
  const connected = Boolean(gitlab?.accessToken?.value && gitlab?.instanceUrl);
  return {
    connected,
    instanceUrl: connected ? (gitlab?.instanceUrl ?? null) : null,
    username: connected ? (gitlab?.user?.username ?? null) : null,
    tokenExpiresAt: connected ? (gitlab?.tokenExpiresAt ?? null) : null,
  };
}

/** The connected instance and a client for it, or an Auth error. */
export function getGitLabConnection(signal?: AbortSignal): {
  client: GitLabClient;
  instanceUrl: string;
  token: string;
} {
  const gitlab = readSettings().gitlab;
  const token = gitlab?.accessToken?.value;
  if (!token || !gitlab?.instanceUrl) {
    throw new DyadError("Not authenticated with GitLab.", DyadErrorKind.Auth);
  }
  const instanceUrl = normalizeGitLabInstanceUrl(gitlab.instanceUrl);
  return {
    client: new GitLabClient({ instanceUrl, token, signal }),
    instanceUrl,
    token,
  };
}

export async function updateAppGitLabProject({
  appId,
  host,
  projectId,
  projectPath,
  branch,
}: {
  appId: number;
  host: string;
  projectId: number;
  projectPath: string;
  branch?: string;
}): Promise<void> {
  await db
    .update(apps)
    .set({
      gitlabHost: host,
      gitlabProjectId: projectId,
      gitlabProjectPath: projectPath,
      gitlabBranch: branch || "main",
    })
    .where(eq(apps.id, appId));
}

/**
 * Checks the app may be linked to GitLab and opens a connection for it.
 *
 * Both link paths need this, and both then hand the credential to git, so
 * they share one implementation rather than two copies that can drift.
 */
async function beginGitLabLink(appId: number) {
  const app = await findAppOrThrow(appId);
  assertCanLinkProvider(app, "gitlab");
  return getGitLabConnection();
}

/** Points the local repo at the project and records it on the app row. */
async function linkAppToGitLabProject({
  appId,
  project,
  instanceUrl,
  token,
  branch,
}: {
  appId: number;
  project: GitLabProject;
  instanceUrl: string;
  token: string;
  branch?: string;
}): Promise<void> {
  const remote = gitlabRemote({
    host: instanceUrl,
    projectId: project.id,
    projectPath: project.pathWithNamespace,
    branch,
  });
  await prepareLocalBranch({
    appId,
    branch,
    remoteUrl: remote.httpsUrl,
    auth: gitlabRemoteAuth(instanceUrl, token),
    providerLabel: "GitLab",
  });
  await updateAppGitLabProject({
    appId,
    host: instanceUrl,
    projectId: project.id,
    projectPath: project.pathWithNamespace,
    branch,
  });
}

/**
 * Creates a private project in the chosen namespace and links the app to it.
 * Driven by the github_ops machine, not by IPC directly.
 */
export async function handleCreateGitLabProject({
  appId,
  namespaceId,
  repo,
  branch,
}: {
  appId: number;
  namespaceId: number;
  repo: string;
  branch?: string;
}): Promise<void> {
  const { client, instanceUrl, token } = await beginGitLabLink(appId);

  const path = normalizeGitLabProjectPath(repo);
  const project = await client.createProject({
    name: repo.trim() || path,
    path,
    namespaceId,
  });
  logger.info(
    `Created GitLab project ${project.pathWithNamespace} (${project.id}) on ${gitLabInstanceLabel(instanceUrl)}`,
  );

  await linkAppToGitLabProject({
    appId,
    project,
    instanceUrl,
    token,
    branch,
  });
}

/**
 * Links the app to a project the user already has. Driven by the github_ops
 * machine, not by IPC directly.
 */
export async function handleConnectToExistingGitLabProject({
  appId,
  projectId,
  branch,
}: {
  appId: number;
  projectId: number;
  branch?: string;
}): Promise<void> {
  const { client, instanceUrl, token } = await beginGitLabLink(appId);

  // Verifies the project exists and the token can see it, and yields the
  // canonical path to store rather than whatever the picker had cached.
  const project = await client.getProject(projectId);

  await linkAppToGitLabProject({
    appId,
    project,
    instanceUrl,
    token,
    branch,
  });
}

export function registerGitLabHandlers() {
  createTypedHandler(gitlabContracts.getStatus, async () => readStatus());

  // DO NOT LOG this handler: it carries a personal access token.
  createTypedHandler(
    gitlabContracts.saveToken,
    async (_, { instanceUrl, token, acknowledgedInsecure }) => {
      if (!isSecureInstanceUrl(instanceUrl) && !acknowledgedInsecure) {
        throw new DyadError(
          "This address is not encrypted, so your access token would be readable " +
            "by anything on the network between you and the server. Confirm you " +
            "want to continue, or give the instance a certificate first.",
          DyadErrorKind.Validation,
        );
      }
      const normalized = normalizeGitLabInstanceUrl(instanceUrl);
      const probe = new GitLabClient({ instanceUrl: normalized, token });
      // One call validates the address and the token together.
      const user = await probe.getCurrentUser();
      // The scope check is advisory on instances too old to report it: the
      // user call above already proved the token works at all.
      const info = await probe.getTokenInfo();
      if (info && !info.active) {
        throw new DyadError(
          "This access token is no longer active. Create a new one in GitLab and try again.",
          DyadErrorKind.Auth,
        );
      }
      if (info && !info.scopes.includes(GITLAB_REQUIRED_SCOPE)) {
        throw new DyadError(
          `This access token has the scopes ${info.scopes.join(", ") || "(none)"}, ` +
            `but Dyad needs the ${GITLAB_REQUIRED_SCOPE} scope to create projects, ` +
            "list groups and add deploy keys. Create a token with that scope and try again.",
          DyadErrorKind.Validation,
        );
      }
      // Read again right before writing: the probe above crossed the network.
      writeSettings({
        gitlab: {
          ...readSettings().gitlab,
          instanceUrl: normalized,
          accessToken: { value: token },
          user: {
            username: user.username,
            name: user.name,
            email: user.email,
          },
          tokenExpiresAt: info?.expiresAt ?? null,
        },
      });
      logger.info(
        `Connected GitLab at ${gitLabInstanceLabel(normalized)} as ${user.username}`,
      );
      return readStatus();
    },
  );

  createTypedHandler(gitlabContracts.clearToken, async () => {
    // Every field named, for the same reason forgottenCoolify exists: an
    // absent key reads to writeSettings as a secret it could not decrypt.
    // App rows are not touched; they keep saying which project they belong
    // to, and simply read as disconnected until a token is back.
    writeSettings({ gitlab: forgottenGitLab() });
  });

  createTypedHandler(gitlabContracts.listNamespaces, async () => {
    const { client } = getGitLabConnection();
    const [user, groups] = await Promise.all([
      client.getCurrentUser(),
      client.listGroups(),
    ]);
    const personal: GitLabNamespace[] =
      user.namespaceId !== null
        ? [
            {
              id: user.namespaceId,
              fullPath: user.username,
              kind: "user",
              name: user.name,
            },
          ]
        : await client.findUserNamespace(user.username);
    return [...personal, ...groups];
  });

  createTypedHandler(gitlabContracts.listProjects, async () => {
    const { client } = getGitLabConnection();
    const projects = await client.listProjects();
    return projects.map((project) => ({
      id: project.id,
      name: project.name,
      pathWithNamespace: project.pathWithNamespace,
      visibility: project.visibility,
      defaultBranch: project.defaultBranch,
    }));
  });

  createTypedHandler(
    gitlabContracts.getProjectBranches,
    async (_, { projectId }) => {
      const { client } = getGitLabConnection();
      const branches = await client.listBranches(projectId);
      return branches.map((branch) => ({ name: branch.name }));
    },
  );

  createTypedHandler(
    gitlabContracts.isProjectAvailable,
    async (_, { namespaceFullPath, path }) => {
      const normalizedPath = normalizeGitLabProjectPath(path);
      let client: GitLabClient;
      try {
        client = getGitLabConnection().client;
      } catch {
        return { available: false, error: "Not authenticated with GitLab." };
      }
      try {
        await client.getProject(`${namespaceFullPath}/${normalizedPath}`);
        return { available: false, error: "Project already exists." };
      } catch (err) {
        if (isGitLabStatus(err, 404)) return { available: true };
        return {
          available: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    },
  );
}
