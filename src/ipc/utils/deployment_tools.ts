import { z } from "zod";
import type { ToolSet } from "ai";
import log from "electron-log";

import type { UserSettings } from "@/lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  fetchGithubAccount,
  githubApiJson,
  parseRepoFullName,
} from "./github_api_utils";
import type { ChatAgentToolPresentation } from "../types/chat_agent";

const logger = log.scope("deployment_tools");

const VERCEL_API_BASE = "https://api.vercel.com";

type ToolResultCallback = (result: {
  serverName: string;
  toolName: string;
  result: string;
  status: "completed" | "error";
  presentation?: ChatAgentToolPresentation;
}) => void;

export function hasGithubAccess(settings: UserSettings): boolean {
  return !!settings.githubAccessToken?.value;
}

export function hasVercelAccess(settings: UserSettings): boolean {
  return !!settings.vercelAccessToken?.value;
}

async function vercelApi<T>(
  settings: UserSettings,
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = settings.vercelAccessToken?.value;
  if (!token) {
    throw new DyadError("Vercel is not connected.", DyadErrorKind.Auth);
  }
  const response = await fetch(`${VERCEL_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new DyadError(
      `Vercel request failed (${response.status}): ${detail.slice(0, 300)}`,
      DyadErrorKind.External,
    );
  }
  return (await response.json()) as T;
}

/**
 * Wrap a tool body so every call reports to the chat UI and never leaks a
 * token into the transcript.
 */
function instrument<TInput>(
  onToolResult: ToolResultCallback,
  serverName: string,
  toolName: string,
  run: (input: TInput) => Promise<unknown>,
) {
  return async (input: TInput) => {
    try {
      const payload = await run(input);
      const result = JSON.stringify(payload);
      onToolResult({ serverName, toolName, result, status: "completed" });
      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The request failed.";
      logger.warn(`${toolName} failed`, message);
      onToolResult({ serverName, toolName, result: message, status: "error" });
      throw error instanceof Error ? error : new Error(message);
    }
  };
}

/**
 * GitHub and Vercel tools for the Web Dev agent.
 *
 * Only the tools whose service has a saved token are returned, so the model
 * never sees a capability it cannot use. Deletions are deliberately excluded:
 * an agent may create and deploy, but removing a repo or project stays a
 * human action.
 */
export function buildDeploymentToolSet(
  settings: UserSettings,
  onToolResult: ToolResultCallback,
): ToolSet {
  const tools: ToolSet = {};

  if (hasGithubAccess(settings)) {
    tools.github_list_repos = {
      description:
        "List the GitHub repositories this account can push to. Use before creating a repo to check whether one already exists.",
      inputSchema: z.object({
        perPage: z.number().int().min(1).max(100).default(30),
      }),
      execute: instrument(
        onToolResult,
        "GitHub",
        "List repositories",
        async ({ perPage }: { perPage: number }) => {
          const repos = await githubApiJson<
            {
              full_name: string;
              private: boolean;
              html_url: string;
              default_branch: string;
            }[]
          >(`/user/repos?per_page=${perPage}&sort=updated`);
          return repos.map((repo) => ({
            fullName: repo.full_name,
            private: repo.private,
            url: repo.html_url,
            defaultBranch: repo.default_branch,
          }));
        },
      ),
    };

    tools.github_create_repo = {
      description:
        "Create a new GitHub repository on the connected account. Returns the repository full name and clone URL.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .max(100)
          .regex(
            /^[A-Za-z0-9._-]+$/,
            "Repository names may only contain letters, numbers, dots, hyphens and underscores.",
          ),
        description: z.string().max(350).optional(),
        private: z.boolean().default(true),
      }),
      execute: instrument(
        onToolResult,
        "GitHub",
        "Create repository",
        async (input: {
          name: string;
          description?: string;
          private: boolean;
        }) => {
          const repo = await githubApiJson<{
            full_name: string;
            html_url: string;
            clone_url: string;
            default_branch: string;
          }>("/user/repos", {
            method: "POST",
            body: {
              name: input.name,
              description: input.description,
              private: input.private,
              auto_init: true,
            },
          });
          return {
            fullName: repo.full_name,
            url: repo.html_url,
            cloneUrl: repo.clone_url,
            defaultBranch: repo.default_branch,
          };
        },
      ),
    };

    tools.github_put_file = {
      description:
        "Create or update a single file in a GitHub repository and commit it. Use for small files such as README, config or source files.",
      inputSchema: z.object({
        repoFullName: z.string().min(3),
        path: z.string().min(1),
        content: z.string(),
        message: z.string().min(1).max(200),
        branch: z.string().optional(),
      }),
      execute: instrument(
        onToolResult,
        "GitHub",
        "Commit file",
        async (input: {
          repoFullName: string;
          path: string;
          content: string;
          message: string;
          branch?: string;
        }) => {
          const { owner, repo } = parseRepoFullName(input.repoFullName);
          const encodedPath = input.path
            .split("/")
            .map(encodeURIComponent)
            .join("/");

          // An update needs the blob sha of the existing file.
          let sha: string | undefined;
          try {
            const existing = await githubApiJson<{ sha: string }>(
              `/repos/${owner}/${repo}/contents/${encodedPath}${
                input.branch ? `?ref=${encodeURIComponent(input.branch)}` : ""
              }`,
            );
            sha = existing.sha;
          } catch {
            // Missing file: this is a create.
          }

          const result = await githubApiJson<{
            content: { html_url: string; path: string };
            commit: { sha: string };
          }>(`/repos/${owner}/${repo}/contents/${encodedPath}`, {
            method: "PUT",
            body: {
              message: input.message,
              content: Buffer.from(input.content, "utf8").toString("base64"),
              branch: input.branch,
              sha,
            },
          });
          return {
            path: result.content.path,
            url: result.content.html_url,
            commit: result.commit.sha,
            created: !sha,
          };
        },
      ),
    };

    tools.github_account = {
      description:
        "Show which GitHub account is connected. Use to confirm the target owner before creating a repository.",
      inputSchema: z.object({}),
      execute: instrument(onToolResult, "GitHub", "Account", async () =>
        fetchGithubAccount(),
      ),
    };
  }

  if (hasVercelAccess(settings)) {
    tools.vercel_list_projects = {
      description:
        "List Vercel projects on the connected account, with their production URLs.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(20),
      }),
      execute: instrument(
        onToolResult,
        "Vercel",
        "List projects",
        async ({ limit }: { limit: number }) => {
          const data = await vercelApi<{
            projects: {
              id: string;
              name: string;
              framework: string | null;
              targets?: { production?: { url?: string } };
            }[];
          }>(settings, `/v9/projects?limit=${limit}`);
          return data.projects.map((project) => ({
            id: project.id,
            name: project.name,
            framework: project.framework,
            productionUrl: project.targets?.production?.url
              ? `https://${project.targets.production.url}`
              : null,
          }));
        },
      ),
    };

    tools.vercel_create_project = {
      description:
        "Create a Vercel project, optionally linked to a GitHub repository so pushes deploy automatically.",
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .max(100)
          .regex(
            /^[a-z0-9._-]+$/,
            "Vercel project names must be lowercase letters, numbers, dots, hyphens or underscores.",
          ),
        framework: z.string().optional(),
        /** owner/repo — requires the GitHub account to be linked in Vercel. */
        gitRepository: z.string().optional(),
      }),
      execute: instrument(
        onToolResult,
        "Vercel",
        "Create project",
        async (input: {
          name: string;
          framework?: string;
          gitRepository?: string;
        }) => {
          const project = await vercelApi<{ id: string; name: string }>(
            settings,
            "/v11/projects",
            {
              method: "POST",
              body: {
                name: input.name,
                framework: input.framework,
                ...(input.gitRepository
                  ? {
                      gitRepository: {
                        type: "github",
                        repo: input.gitRepository,
                      },
                    }
                  : {}),
              },
            },
          );
          return {
            id: project.id,
            name: project.name,
            dashboardUrl: `https://vercel.com/dashboard`,
          };
        },
      ),
    };

    tools.vercel_list_deployments = {
      description:
        "List recent Vercel deployments for a project, including state and URL. Use to report whether a deploy succeeded.",
      inputSchema: z.object({
        projectId: z.string().min(1),
        limit: z.number().int().min(1).max(20).default(5),
      }),
      execute: instrument(
        onToolResult,
        "Vercel",
        "List deployments",
        async (input: { projectId: string; limit: number }) => {
          const data = await vercelApi<{
            deployments: {
              uid: string;
              url: string;
              state: string;
              readyState?: string;
              createdAt: number;
            }[];
          }>(
            settings,
            `/v6/deployments?projectId=${encodeURIComponent(
              input.projectId,
            )}&limit=${input.limit}`,
          );
          return data.deployments.map((deployment) => ({
            id: deployment.uid,
            url: `https://${deployment.url}`,
            state: deployment.readyState ?? deployment.state,
            createdAt: new Date(deployment.createdAt).toISOString(),
          }));
        },
      ),
    };

    tools.vercel_deploy_project = {
      description:
        "Trigger a new production deployment for a Vercel project from its linked Git repository. Only call after confirming the project is linked to a repo.",
      inputSchema: z.object({
        projectName: z.string().min(1),
        /** owner/repo of the linked GitHub repository. */
        gitRepository: z.string().min(3),
        ref: z.string().default("main"),
      }),
      execute: instrument(
        onToolResult,
        "Vercel",
        "Deploy project",
        async (input: {
          projectName: string;
          gitRepository: string;
          ref: string;
        }) => {
          const [org, repo] = input.gitRepository.split("/");
          if (!org || !repo) {
            throw new DyadError(
              "gitRepository must be in owner/repo form.",
              DyadErrorKind.Validation,
            );
          }
          const deployment = await vercelApi<{
            id: string;
            url: string;
            readyState?: string;
          }>(settings, "/v13/deployments", {
            method: "POST",
            body: {
              name: input.projectName,
              target: "production",
              gitSource: {
                type: "github",
                org,
                repo,
                ref: input.ref,
              },
            },
          });
          return {
            id: deployment.id,
            url: `https://${deployment.url}`,
            state: deployment.readyState ?? "QUEUED",
          };
        },
      ),
    };
  }

  return tools;
}

/** Prompt guidance describing whichever deployment tools are available. */
export function deploymentToolsPrompt(settings: UserSettings): string {
  const github = hasGithubAccess(settings);
  const vercel = hasVercelAccess(settings);
  if (!github && !vercel) {
    return [
      "GitHub and Vercel are not connected. If the user asks you to publish or deploy,",
      "tell them to connect the accounts in Settings → Integrations first — do not claim you deployed anything.",
    ].join(" ");
  }

  const lines = ["Connected deployment services:"];
  if (github) {
    lines.push(
      "- GitHub is connected. You can list repositories, create a repository, commit single files, and check the connected account.",
      "- Confirm the repository name with the user before creating it. You cannot delete repositories.",
    );
  }
  if (vercel) {
    lines.push(
      "- Vercel is connected. You can list projects, create a project, trigger a production deployment, and read deployment state.",
      "- To deploy from Git, the Vercel project must be linked to a GitHub repository. Create the repo and project first, then deploy.",
      "- After deploying, report the deployment state and URL from the tool result. Never claim a deploy succeeded until the tool confirms it.",
    );
  }
  if (github && !vercel) {
    lines.push("- Vercel is not connected, so you cannot deploy yet.");
  }
  if (vercel && !github) {
    lines.push(
      "- GitHub is not connected, so you cannot create or push repositories yet.",
    );
  }
  return lines.join("\n");
}
