/**
 * Auto-Deploy IPC Handlers
 *
 * Orchestrates the full deploy pipeline:
 *   1. Run site completeness check (optional)
 *   2. Push to GitHub (create repo if needed)
 *   3. Deploy to target platform (Vercel or 4everland/decentralized)
 *
 * This provides a one-click deploy experience from the Publish panel.
 */

import { ipcMain, IpcMainInvokeEvent } from "electron";
import { db } from "../../db";
import { apps } from "../../db/schema";
import { eq } from "drizzle-orm";
import { readSettings } from "../../main/settings";
import { getJoyAppPath } from "../../paths/paths";
import {
  gitSetRemoteUrl,
  gitPush,
  gitAddAll,
  gitCommit,
} from "../utils/git_utils";
import { checkSiteCompleteness, type CompletenessReport } from "../utils/site_completeness";
import { updateAppVercelProject } from "./vercel_handlers";
import { deployToPlatform } from "./decentralized_deploy_handlers";
import log from "electron-log";
import * as fs from "node:fs";
import * as path from "node:path";
import { safeSend } from "../utils/safe_sender";

const logger = log.scope("auto_deploy_handlers");

// ============================================================================
// Types
// ============================================================================

export interface AutoDeployRequest {
  appId: number;
  /** Target platform: "vercel" | "4everland" | other decentralized platform */
  target: "vercel" | "4everland" | "fleek" | "ipfs-pinata" | "ipfs-web3storage" | "arweave" | "spheron";
  /** Skip completeness check */
  skipCompletenessCheck?: boolean;
  /** Build command for decentralized deploys */
  buildCommand?: string;
  /** Output directory for decentralized deploys */
  outputDir?: string;
}

export interface AutoDeployStep {
  step: "completeness-check" | "github-setup" | "github-push" | "deploy";
  status: "pending" | "running" | "success" | "skipped" | "error";
  message: string;
  details?: string;
}

export interface AutoDeployResult {
  success: boolean;
  steps: AutoDeployStep[];
  deploymentUrl?: string;
  error?: string;
  completenessReport?: CompletenessReport;
}

// ============================================================================
// GitHub Helpers (reused from github_handlers)
// ============================================================================

const GITHUB_API_BASE = "https://api.github.com";

async function ensureGithubRepo(
  appId: number,
  accessToken: string,
): Promise<{ org: string; repo: string; created: boolean }> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");

  // Already has a repo
  if (app.githubOrg && app.githubRepo) {
    return { org: app.githubOrg, repo: app.githubRepo, created: false };
  }

  // Create a new repo
  const userRes = await fetch(`${GITHUB_API_BASE}/user`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userRes.ok) throw new Error("Failed to get GitHub user info");
  const user = await userRes.json();
  const owner = user.login;

  // Sanitize app name into a valid repo name
  const repoName = (app.name || `joycreate-app-${appId}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 100);

  // Check if repo exists
  const checkRes = await fetch(`${GITHUB_API_BASE}/repos/${owner}/${repoName}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (checkRes.ok) {
    // Repo already exists, just link it
    await db
      .update(apps)
      .set({ githubOrg: owner, githubRepo: repoName, githubBranch: "main" })
      .where(eq(apps.id, appId));
    return { org: owner, repo: repoName, created: false };
  }

  // Create the repo
  const createRes = await fetch(`${GITHUB_API_BASE}/user/repos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({
      name: repoName,
      private: true,
      auto_init: false,
    }),
  });

  if (!createRes.ok) {
    const error = await createRes.json().catch(() => ({ message: createRes.statusText }));
    throw new Error(`Failed to create GitHub repo: ${error.message}`);
  }

  await db
    .update(apps)
    .set({ githubOrg: owner, githubRepo: repoName, githubBranch: "main" })
    .where(eq(apps.id, appId));

  return { org: owner, repo: repoName, created: true };
}

async function pushToGithub(
  appId: number,
  accessToken: string,
  org: string,
  repo: string,
): Promise<void> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");

  const appPath = getJoyAppPath(app.path);
  const branch = app.githubBranch || "main";

  // Ensure git repo is initialized and files are committed
  const gitDir = path.join(appPath, ".git");
  if (!fs.existsSync(gitDir)) {
    const { execSync } = await import("child_process");
    execSync("git init", { cwd: appPath });
    execSync('git config user.email "joycreate@app.local"', { cwd: appPath });
    execSync('git config user.name "JoyCreate"', { cwd: appPath });
  }

  // Stage all files
  await gitAddAll({ path: appPath });

  // Commit
  try {
    await gitCommit({
      path: appPath,
      message: "Deploy via JoyCreate",
    });
  } catch {
    // Commit may fail if nothing to commit — that's OK
    logger.info("Git commit skipped (likely nothing new to commit)");
  }

  // Set remote and push
  const remoteUrl = `https://${accessToken}:x-oauth-basic@github.com/${org}/${repo}.git`;
  await gitSetRemoteUrl({ path: appPath, remoteUrl });
  await gitPush({ path: appPath, branch, accessToken });
}

// ============================================================================
// Main Auto-Deploy Handler
// ============================================================================

async function handleAutoDeploy(
  event: IpcMainInvokeEvent,
  request: AutoDeployRequest,
): Promise<AutoDeployResult> {
  const steps: AutoDeployStep[] = [];
  const settings = readSettings();

  logger.info(`Auto-deploy started for app ${request.appId} → ${request.target}`);

  // ── Step 1: Completeness Check ──
  const completenessStep: AutoDeployStep = {
    step: "completeness-check",
    status: "running",
    message: "Checking site completeness...",
  };

  let completenessReport: CompletenessReport | undefined;

  if (request.skipCompletenessCheck) {
    completenessStep.status = "skipped";
    completenessStep.message = "Completeness check skipped";
    steps.push(completenessStep);
  } else {
    steps.push(completenessStep);

    try {
      const app = await db.query.apps.findFirst({ where: eq(apps.id, request.appId) });
      if (!app) throw new Error("App not found");

      const appPath = getJoyAppPath(app.path);
      completenessReport = await checkSiteCompleteness(appPath);

      if (completenessReport.isComplete) {
        completenessStep.status = "success";
        completenessStep.message = "Site is complete";
      } else {
        completenessStep.status = "success";
        completenessStep.message = `${completenessReport.issues.length} minor issue(s) found — proceeding with deploy`;
        completenessStep.details = completenessReport.issues
          .slice(0, 5)
          .map((i) => `${i.type}: ${i.message}`)
          .join("\n");
      }
    } catch (err) {
      completenessStep.status = "error";
      completenessStep.message = `Completeness check failed: ${err instanceof Error ? err.message : String(err)}`;
      // Non-fatal: continue with deploy
    }
  }

  // Send progress update
  safeSend(event.sender, "auto-deploy:progress", {
    appId: request.appId,
    steps: [...steps],
  });

  // ── Step 2: GitHub Setup ──
  const githubSetupStep: AutoDeployStep = {
    step: "github-setup",
    status: "running",
    message: "Setting up GitHub repository...",
  };
  steps.push(githubSetupStep);

  const accessToken = settings.githubAccessToken?.value;
  if (!accessToken) {
    githubSetupStep.status = "error";
    githubSetupStep.message = "Not authenticated with GitHub. Please connect your GitHub account first.";
    return {
      success: false,
      steps,
      error: githubSetupStep.message,
      completenessReport,
    };
  }

  let org: string;
  let repo: string;

  try {
    const result = await ensureGithubRepo(request.appId, accessToken);
    org = result.org;
    repo = result.repo;
    githubSetupStep.status = "success";
    githubSetupStep.message = result.created
      ? `Created GitHub repo: ${org}/${repo}`
      : `Using existing repo: ${org}/${repo}`;
  } catch (err) {
    githubSetupStep.status = "error";
    githubSetupStep.message = `GitHub setup failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      success: false,
      steps,
      error: githubSetupStep.message,
      completenessReport,
    };
  }

  safeSend(event.sender, "auto-deploy:progress", {
    appId: request.appId,
    steps: [...steps],
  });

  // ── Step 3: Push to GitHub ──
  const pushStep: AutoDeployStep = {
    step: "github-push",
    status: "running",
    message: "Pushing code to GitHub...",
  };
  steps.push(pushStep);

  try {
    await pushToGithub(request.appId, accessToken, org, repo);
    pushStep.status = "success";
    pushStep.message = `Pushed to github.com/${org}/${repo}`;
  } catch (err) {
    pushStep.status = "error";
    pushStep.message = `Push failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      success: false,
      steps,
      error: pushStep.message,
      completenessReport,
    };
  }

  safeSend(event.sender, "auto-deploy:progress", {
    appId: request.appId,
    steps: [...steps],
  });

  // ── Step 4: Deploy to Target Platform ──
  const deployStep: AutoDeployStep = {
    step: "deploy",
    status: "running",
    message: `Deploying to ${request.target}...`,
  };
  steps.push(deployStep);

  try {
    let deploymentUrl: string | undefined;

    if (request.target === "vercel") {
      deploymentUrl = await deployToVercel(event, request.appId, org, repo);
    } else {
      deploymentUrl = await deployToDecentralized(event, request);
    }

    deployStep.status = "success";
    deployStep.message = deploymentUrl
      ? `Deployed successfully: ${deploymentUrl}`
      : "Deployment triggered successfully";

    safeSend(event.sender, "auto-deploy:progress", {
      appId: request.appId,
      steps: [...steps],
    });

    return {
      success: true,
      steps,
      deploymentUrl,
      completenessReport,
    };
  } catch (err) {
    deployStep.status = "error";
    deployStep.message = `Deploy failed: ${err instanceof Error ? err.message : String(err)}`;
    return {
      success: false,
      steps,
      error: deployStep.message,
      completenessReport,
    };
  }
}

// ============================================================================
// Platform-Specific Deploy Functions
// ============================================================================

async function deployToVercel(
  event: IpcMainInvokeEvent,
  appId: number,
  org: string,
  repo: string,
): Promise<string | undefined> {
  const settings = readSettings();
  const vercelToken = settings.vercelAccessToken?.value;
  if (!vercelToken) {
    throw new Error("Not authenticated with Vercel. Please add your Vercel token first.");
  }

  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");

  const { Vercel } = await import("@vercel/sdk");
  const vercel = new Vercel({ bearerToken: vercelToken });

  // If already has a Vercel project, trigger a new deployment
  if (app.vercelProjectId) {
    const deploymentData = await vercel.deployments.createDeployment({
      requestBody: {
        name: app.vercelProjectName || app.name,
        project: app.vercelProjectId,
        target: "production",
        gitSource: {
          type: "github",
          org,
          repo,
          ref: app.githubBranch || "main",
        },
      },
    });

    return deploymentData.url ? `https://${deploymentData.url}` : app.vercelDeploymentUrl ?? undefined;
  }

  // Create a new Vercel project with GitHub link

  // Auto-detect framework
  const appPath = getJoyAppPath(app.path);
  let framework: string | undefined;
  const configChecks = [
    { file: "next.config.js", fw: "nextjs" },
    { file: "next.config.mjs", fw: "nextjs" },
    { file: "next.config.ts", fw: "nextjs" },
    { file: "vite.config.js", fw: "vite" },
    { file: "vite.config.ts", fw: "vite" },
    { file: "vite.config.mjs", fw: "vite" },
    { file: "nuxt.config.js", fw: "nuxtjs" },
    { file: "nuxt.config.ts", fw: "nuxtjs" },
    { file: "astro.config.mjs", fw: "astro" },
    { file: "svelte.config.js", fw: "svelte" },
  ];
  for (const { file, fw } of configChecks) {
    if (fs.existsSync(path.join(appPath, file))) {
      framework = fw;
      break;
    }
  }
  if (!framework) {
    // Check package.json deps
    const pkgPath = path.join(appPath, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.next) framework = "nextjs";
        else if (deps.vite) framework = "vite";
        else if (deps.nuxt) framework = "nuxtjs";
        else if (deps.astro) framework = "astro";
      } catch { /* ignore */ }
    }
  }

  const projectName = (app.name || `joycreate-${appId}`)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .substring(0, 100);

  const projectData = await vercel.projects.createProject({
    requestBody: {
      name: projectName,
      gitRepository: {
        type: "github",
        repo: `${org}/${repo}`,
      },
      framework: framework as any,
    },
  });

  if (!projectData.id) {
    throw new Error("Failed to create Vercel project: No project ID returned.");
  }

  // Get team ID for storage
  let teamId = "";
  try {
    const teamRes = await fetch("https://api.vercel.com/v2/teams?limit=1", {
      headers: { Authorization: `Bearer ${vercelToken}` },
    });
    if (teamRes.ok) {
      const teamData = await teamRes.json();
      teamId = teamData.teams?.[0]?.id || "";
    }
  } catch { /* ignore */ }

  // Get project URL
  let projectUrl: string | undefined;
  try {
    const domains = await vercel.projects.getProjectDomains({
      idOrName: projectData.id,
    });
    projectUrl = "https://" + domains.domains[0].name;
  } catch { /* ignore */ }

  // Store project info
  await updateAppVercelProject({
    appId,
    projectId: projectData.id,
    projectName: projectData.name,
    teamId,
    deploymentUrl: projectUrl,
  });

  // Trigger first deployment
  try {
    const deploymentData = await vercel.deployments.createDeployment({
      requestBody: {
        name: projectData.name,
        project: projectData.id,
        target: "production",
        gitSource: {
          type: "github",
          org,
          repo,
          ref: app.githubBranch || "main",
        },
      },
    });
    if (deploymentData.url) {
      return `https://${deploymentData.url}`;
    }
  } catch (err) {
    logger.warn("First deployment trigger failed (non-fatal):", err);
  }

  return projectUrl;
}

async function deployToDecentralized(
  event: IpcMainInvokeEvent,
  request: AutoDeployRequest,
): Promise<string | undefined> {
  const result = await deployToPlatform({
    appId: request.appId,
    platform: request.target as any,
    buildCommand: request.buildCommand || "npm run build",
    outputDir: request.outputDir || "dist",
  });

  if (!result.success) {
    throw new Error(result.error || `Deployment to ${request.target} failed`);
  }

  return result.url || result.gatewayUrls?.[0];
}

// ============================================================================
// Completeness Check Handler (standalone)
// ============================================================================

async function handleCheckCompleteness(
  event: IpcMainInvokeEvent,
  { appId }: { appId: number },
): Promise<CompletenessReport> {
  const app = await db.query.apps.findFirst({ where: eq(apps.id, appId) });
  if (!app) throw new Error("App not found");
  return checkSiteCompleteness(getJoyAppPath(app.path));
}

// ============================================================================
// Registration
// ============================================================================

export function registerAutoDeployHandlers(): void {
  ipcMain.handle("deploy:auto-deploy", handleAutoDeploy);
  ipcMain.handle("deploy:check-completeness", handleCheckCompleteness);
}
