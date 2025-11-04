import { ipcMain } from "electron";
import { db } from "../../db";
import { apps, deploymentConfigs, deployments } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { readSettings, writeSettings } from "../../main/settings";
import log from "electron-log";
import { createLoggedHandler } from "./safe_handle";
import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import { getDyadAppPath } from "@/paths/paths";

const execPromise = promisify(exec);
const logger = log.scope("deployment_handlers");
const handle = createLoggedHandler(logger);

export type DeploymentProvider = "aws" | "cloudflare" | "netlify";

export interface DeploymentConfig {
  id?: number;
  appId: number;
  provider: DeploymentProvider;
  projectId?: string;
  projectName?: string;
  accessToken?: string;
  region?: string;
  deploymentUrl?: string;
  config?: Record<string, unknown>;
  enabled?: boolean;
}

export interface CreateDeploymentParams {
  appId: number;
  configId: number;
  commitHash?: string;
}

// ==================== AWS Amplify ====================

/**
 * Configure AWS Amplify deployment
 */
handle(
  "deployment:aws:configure",
  async (event, params: Omit<DeploymentConfig, "provider">) => {
    logger.info("Configuring AWS Amplify deployment", params);

    const config = await db
      .insert(deploymentConfigs)
      .values({
        ...params,
        provider: "aws",
      })
      .returning();

    return config[0];
  },
);

/**
 * Deploy to AWS Amplify
 */
handle("deployment:aws:deploy", async (event, params: CreateDeploymentParams) => {
  const { appId, configId, commitHash } = params;

  logger.info("Deploying to AWS Amplify", { appId, configId });

  // Get config
  const config = await db.query.deploymentConfigs.findFirst({
    where: and(
      eq(deploymentConfigs.id, configId),
      eq(deploymentConfigs.provider, "aws"),
    ),
  });

  if (!config) {
    throw new Error("AWS deployment config not found");
  }

  // Get app
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
  });

  if (!app) {
    throw new Error("App not found");
  }

  const appPath = getDyadAppPath(app.path);

  // Create deployment record
  const [deployment] = await db
    .insert(deployments)
    .values({
      appId,
      configId,
      provider: "aws",
      status: "pending",
      commitHash,
    })
    .returning();

  try {
    // Update status to building
    await db
      .update(deployments)
      .set({ status: "building" })
      .where(eq(deployments.id, deployment.id));

    // Deploy using AWS Amplify CLI
    // Note: Requires AWS CLI and Amplify CLI to be installed
    const { stdout, stderr } = await execPromise(
      `cd "${appPath}" && amplify publish --yes`,
      {
        env: {
          ...process.env,
          AWS_ACCESS_KEY_ID: config.accessToken,
          AWS_REGION: config.region || "us-east-1",
        },
      },
    );

    logger.info("AWS Amplify deployment output:", stdout);

    // Parse deployment URL from output (this is simplified)
    const urlMatch = stdout.match(/https:\/\/[^\s]+/);
    const deploymentUrl = urlMatch ? urlMatch[0] : undefined;

    // Update deployment record
    await db
      .update(deployments)
      .set({
        status: "ready",
        url: deploymentUrl,
        logs: stdout + "\n" + stderr,
      })
      .where(eq(deployments.id, deployment.id));

    // Update config with deployment URL
    if (deploymentUrl) {
      await db
        .update(deploymentConfigs)
        .set({ deploymentUrl })
        .where(eq(deploymentConfigs.id, configId));
    }

    return { ...deployment, status: "ready" as const, url: deploymentUrl };
  } catch (error) {
    logger.error("AWS Amplify deployment failed:", error);

    await db
      .update(deployments)
      .set({
        status: "error",
        logs: error instanceof Error ? error.message : String(error),
      })
      .where(eq(deployments.id, deployment.id));

    throw error;
  }
});

// ==================== Cloudflare Pages ====================

/**
 * Configure Cloudflare Pages deployment
 */
handle(
  "deployment:cloudflare:configure",
  async (event, params: Omit<DeploymentConfig, "provider">) => {
    logger.info("Configuring Cloudflare Pages deployment", params);

    const config = await db
      .insert(deploymentConfigs)
      .values({
        ...params,
        provider: "cloudflare",
      })
      .returning();

    return config[0];
  },
);

/**
 * Deploy to Cloudflare Pages
 */
handle(
  "deployment:cloudflare:deploy",
  async (event, params: CreateDeploymentParams) => {
    const { appId, configId, commitHash } = params;

    logger.info("Deploying to Cloudflare Pages", { appId, configId });

    const config = await db.query.deploymentConfigs.findFirst({
      where: and(
        eq(deploymentConfigs.id, configId),
        eq(deploymentConfigs.provider, "cloudflare"),
      ),
    });

    if (!config || !config.accessToken) {
      throw new Error("Cloudflare deployment config or API token not found");
    }

    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    const appPath = getDyadAppPath(app.path);

    // Create deployment record
    const [deployment] = await db
      .insert(deployments)
      .values({
        appId,
        configId,
        provider: "cloudflare",
        status: "pending",
        commitHash,
      })
      .returning();

    try {
      await db
        .update(deployments)
        .set({ status: "building" })
        .where(eq(deployments.id, deployment.id));

      // Build the project first
      const { stdout: buildOut } = await execPromise(`cd "${appPath}" && npm run build`);

      // Deploy using Wrangler (Cloudflare CLI)
      const { stdout, stderr } = await execPromise(
        `cd "${appPath}" && npx wrangler pages deploy ./dist --project-name=${config.projectName}`,
        {
          env: {
            ...process.env,
            CLOUDFLARE_API_TOKEN: config.accessToken,
          },
        },
      );

      logger.info("Cloudflare Pages deployment output:", stdout);

      // Parse deployment URL
      const urlMatch = stdout.match(/https:\/\/[a-zA-Z0-9-]+\.pages\.dev/);
      const deploymentUrl = urlMatch ? urlMatch[0] : undefined;

      await db
        .update(deployments)
        .set({
          status: "ready",
          url: deploymentUrl,
          logs: buildOut + "\n" + stdout + "\n" + stderr,
        })
        .where(eq(deployments.id, deployment.id));

      if (deploymentUrl) {
        await db
          .update(deploymentConfigs)
          .set({ deploymentUrl })
          .where(eq(deploymentConfigs.id, configId));
      }

      return { ...deployment, status: "ready" as const, url: deploymentUrl };
    } catch (error) {
      logger.error("Cloudflare Pages deployment failed:", error);

      await db
        .update(deployments)
        .set({
          status: "error",
          logs: error instanceof Error ? error.message : String(error),
        })
        .where(eq(deployments.id, deployment.id));

      throw error;
    }
  },
);

// ==================== Netlify ====================

/**
 * Configure Netlify deployment
 */
handle(
  "deployment:netlify:configure",
  async (event, params: Omit<DeploymentConfig, "provider">) => {
    logger.info("Configuring Netlify deployment", params);

    const config = await db
      .insert(deploymentConfigs)
      .values({
        ...params,
        provider: "netlify",
      })
      .returning();

    return config[0];
  },
);

/**
 * Deploy to Netlify
 */
handle(
  "deployment:netlify:deploy",
  async (event, params: CreateDeploymentParams) => {
    const { appId, configId, commitHash } = params;

    logger.info("Deploying to Netlify", { appId, configId });

    const config = await db.query.deploymentConfigs.findFirst({
      where: and(
        eq(deploymentConfigs.id, configId),
        eq(deploymentConfigs.provider, "netlify"),
      ),
    });

    if (!config || !config.accessToken) {
      throw new Error("Netlify deployment config or auth token not found");
    }

    const app = await db.query.apps.findFirst({
      where: eq(apps.id, appId),
    });

    if (!app) {
      throw new Error("App not found");
    }

    const appPath = getDyadAppPath(app.path);

    // Create deployment record
    const [deployment] = await db
      .insert(deployments)
      .values({
        appId,
        configId,
        provider: "netlify",
        status: "pending",
        commitHash,
      })
      .returning();

    try {
      await db
        .update(deployments)
        .set({ status: "building" })
        .where(eq(deployments.id, deployment.id));

      // Build the project
      const { stdout: buildOut } = await execPromise(`cd "${appPath}" && npm run build`);

      // Deploy using Netlify CLI
      const { stdout, stderr } = await execPromise(
        `cd "${appPath}" && npx netlify deploy --prod --dir=dist --site=${config.projectId}`,
        {
          env: {
            ...process.env,
            NETLIFY_AUTH_TOKEN: config.accessToken,
          },
        },
      );

      logger.info("Netlify deployment output:", stdout);

      // Parse deployment URL
      const urlMatch = stdout.match(/https:\/\/[a-zA-Z0-9-]+\.netlify\.app/);
      const deploymentUrl = urlMatch ? urlMatch[0] : undefined;

      await db
        .update(deployments)
        .set({
          status: "ready",
          url: deploymentUrl,
          logs: buildOut + "\n" + stdout + "\n" + stderr,
        })
        .where(eq(deployments.id, deployment.id));

      if (deploymentUrl) {
        await db
          .update(deploymentConfigs)
          .set({ deploymentUrl })
          .where(eq(deploymentConfigs.id, configId));
      }

      return { ...deployment, status: "ready" as const, url: deploymentUrl };
    } catch (error) {
      logger.error("Netlify deployment failed:", error);

      await db
        .update(deployments)
        .set({
          status: "error",
          logs: error instanceof Error ? error.message : String(error),
        })
        .where(eq(deployments.id, deployment.id));

      throw error;
    }
  },
);

// ==================== Common Deployment Handlers ====================

/**
 * Get all deployment configs for an app
 */
handle("deployment:get-configs", async (event, appId: number) => {
  const configs = await db.query.deploymentConfigs.findMany({
    where: eq(deploymentConfigs.appId, appId),
  });

  return configs;
});

/**
 * Get deployment history for an app
 */
handle("deployment:get-history", async (event, appId: number) => {
  const history = await db.query.deployments.findMany({
    where: eq(deployments.appId, appId),
    orderBy: (deployments, { desc }) => [desc(deployments.createdAt)],
    limit: 50,
  });

  return history;
});

/**
 * Delete deployment config
 */
handle("deployment:delete-config", async (event, configId: number) => {
  await db.delete(deploymentConfigs).where(eq(deploymentConfigs.id, configId));
  return { success: true };
});

/**
 * Update deployment config
 */
handle(
  "deployment:update-config",
  async (event, params: { id: number; updates: Partial<DeploymentConfig> }) => {
    const { id, updates } = params;

    const [updated] = await db
      .update(deploymentConfigs)
      .set(updates)
      .where(eq(deploymentConfigs.id, id))
      .returning();

    return updated;
  },
);

export function registerDeploymentHandlers() {
  logger.info("Deployment handlers registered");
}
