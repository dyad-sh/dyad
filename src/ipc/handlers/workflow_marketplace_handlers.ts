/**
 * Workflow Marketplace IPC Handlers
 * Publishing, unpublishing, and installing workflows from JoyMarketplace
 */

import { ipcMain, app } from "electron";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import log from "electron-log";
import * as fs from "fs-extra";
import * as path from "path";
import type { UnifiedPublishPayload, PublishResult } from "@/types/publish_types";
import type { PublishAppResponse } from "@/types/marketplace_types";
import { JOYMARKETPLACE_API } from "@/config/joymarketplace";

const logger = log.scope("workflow_marketplace");

const MARKETPLACE_API_URL = JOYMARKETPLACE_API.baseUrl;

async function getCredentials(): Promise<{ apiKey: string; publisherId: string }> {
  const credPath = path.join(
    app.getPath("userData"),
    "marketplace-credentials.json"
  );
  if (!(await fs.pathExists(credPath))) {
    throw new Error(
      "Not authenticated with JoyMarketplace. Please connect your account first."
    );
  }
  const data = await fs.readJson(credPath);
  if (!data?.apiKey) throw new Error("Invalid marketplace credentials");
  return data;
}

/**
 * Read a workflow JSON from the local n8n workflows folder
 */
async function readWorkflowFile(
  workflowId: string
): Promise<Record<string, unknown>> {
  const workflowDir = path.join(app.getPath("userData"), "n8n-workflows");
  const filePath = path.join(workflowDir, `${workflowId}.json`);
  if (!(await fs.pathExists(filePath))) {
    throw new Error(`Workflow file not found: ${workflowId}`);
  }
  return fs.readJson(filePath);
}

export function registerWorkflowMarketplaceHandlers() {
  // Publish a workflow to JoyMarketplace
  ipcMain.handle(
    "workflow:publish-to-marketplace",
    async (_, payload: UnifiedPublishPayload): Promise<PublishResult> => {
      const workflowId = String(payload.sourceId);
      logger.info(`Publishing workflow ${workflowId} to marketplace`);

      // Read the workflow JSON
      const workflowJson = await readWorkflowFile(workflowId);

      // Extract metadata from the workflow structure
      const nodes = (workflowJson.nodes as any[]) ?? [];
      const connections = (workflowJson.connections as Record<string, unknown>) ?? {};
      const triggerNode = nodes.find(
        (n: any) =>
          n.type?.includes("Trigger") ||
          n.type?.includes("webhook") ||
          n.type?.includes("cron")
      );

      // Sanitize workflow: remove credentials values (keep type references)
      const sanitizedWorkflow = JSON.parse(JSON.stringify(workflowJson));
      for (const node of (sanitizedWorkflow.nodes ?? []) as any[]) {
        if (node.credentials) {
          for (const key of Object.keys(node.credentials)) {
            const cred = node.credentials[key];
            if (typeof cred === "object" && cred !== null) {
              // Keep only the credential type name, strip IDs and secrets
              node.credentials[key] = { name: cred.name ?? key };
            }
          }
        }
      }

      const { apiKey, publisherId } = await getCredentials();

      const response = await fetch(`${MARKETPLACE_API_URL}/v1/assets/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-Publisher-ID": publisherId,
        },
        body: JSON.stringify({
          ...payload,
          assetType: "workflow",
          category: payload.category || "ai-workflow",
          metadata: {
            nodeCount: nodes.length,
            triggerType: triggerNode?.type ?? "manual",
            connectionCount: Object.keys(connections).length,
            requiresCredentials: nodes.some((n: any) => n.credentials),
            credentialTypes: [
              ...new Set(
                nodes
                  .filter((n: any) => n.credentials)
                  .flatMap((n: any) => Object.keys(n.credentials))
              ),
            ],
          },
          bundle: sanitizedWorkflow,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Marketplace API error: ${response.status} — ${body}`);
      }

      const result = (await response.json()) as PublishAppResponse;
      if (!result.success || !result.assetId) {
        throw new Error(result.message || "Failed to publish workflow");
      }

      // Track publish status locally in the workflow_listings table
      try {
        await db.run(sql`
          INSERT INTO workflow_listings (workflow_id, name, marketplace_id, publish_status, published_at)
          VALUES (${workflowId}, ${payload.name}, ${result.assetId}, 'published', unixepoch())
          ON CONFLICT(workflow_id) DO UPDATE SET
            marketplace_id = ${result.assetId},
            publish_status = 'published',
            published_at = unixepoch(),
            name = ${payload.name}
        `);
      } catch {
        // table may not exist before migration runs
        logger.warn("workflow_listings table not yet available");
      }

      logger.info(`Workflow ${workflowId} published as ${result.assetId}`);

      return {
        assetId: result.assetId,
        assetUrl:
          result.assetUrl ??
          `https://joymarketplace.io/assets/${result.assetId}`,
        status: result.status,
      };
    }
  );

  // Install a workflow from marketplace
  ipcMain.handle(
    "workflow:install-from-marketplace",
    async (_, assetId: string): Promise<{ workflowId: string }> => {
      logger.info(`Installing workflow from marketplace: ${assetId}`);

      const { apiKey } = await getCredentials();
      const response = await fetch(
        `${MARKETPLACE_API_URL}/v1/assets/${encodeURIComponent(assetId)}/download`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Download failed: ${response.status} — ${body}`);
      }

      const workflowJson = await response.json();

      // Persist to local n8n workflows folder
      const workflowDir = path.join(app.getPath("userData"), "n8n-workflows");
      await fs.ensureDir(workflowDir);

      const workflowId =
        workflowJson.id ?? `marketplace-${assetId}-${Date.now()}`;
      const destPath = path.join(workflowDir, `${workflowId}.json`);
      await fs.writeJson(destPath, workflowJson, { spaces: 2 });

      logger.info(`Workflow installed as ${workflowId} at ${destPath}`);

      return { workflowId };
    }
  );

  // Unpublish a workflow
  ipcMain.handle("workflow:unpublish", async (_, workflowId: string) => {
    logger.info(`Unpublishing workflow ${workflowId}`);

    let marketplaceId: string | undefined;
    try {
      const row = await db.get<{ marketplace_id: string }>(
        sql`SELECT marketplace_id FROM workflow_listings WHERE workflow_id = ${workflowId}`
      );
      marketplaceId = row?.marketplace_id;
    } catch {
      throw new Error("Workflow has no marketplace listing");
    }

    if (!marketplaceId) {
      throw new Error("Workflow has no marketplace listing");
    }

    const { apiKey, publisherId } = await getCredentials();
    await fetch(
      `${MARKETPLACE_API_URL}/v1/assets/${encodeURIComponent(marketplaceId)}/archive`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Publisher-ID": publisherId,
        },
      }
    );

    try {
      await db.run(sql`
        UPDATE workflow_listings SET publish_status = 'archived' WHERE workflow_id = ${workflowId}
      `);
    } catch {
      // not critical
    }

    logger.info(`Workflow ${workflowId} unpublished`);
  });

  // List workflow publish statuses
  ipcMain.handle("workflow:list-published", async () => {
    try {
      return await db.all(sql`SELECT * FROM workflow_listings`);
    } catch {
      return [];
    }
  });
}
