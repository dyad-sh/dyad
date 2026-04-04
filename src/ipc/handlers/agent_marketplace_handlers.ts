/**
 * Agent Marketplace IPC Handlers
 * Publishing, unpublishing, and updating agents on JoyMarketplace
 */

import { ipcMain, app } from "electron";
import { db } from "@/db";
import { agents, agentTools, agentKnowledgeBases } from "@/db/schema";
import { eq } from "drizzle-orm";
import log from "electron-log";
import * as fs from "fs-extra";
import * as path from "path";
import type { UnifiedPublishPayload, PublishResult } from "@/types/publish_types";
import type { PublishAppResponse } from "@/types/marketplace_types";

const logger = log.scope("agent_marketplace");

const MARKETPLACE_API_URL =
  process.env.JOYMARKETPLACE_API_URL || "https://api.joymarketplace.io";

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
  if (!data?.apiKey) {
    throw new Error("Invalid marketplace credentials");
  }
  return data;
}

async function publishRequest<T>(
  endpoint: string,
  body: unknown
): Promise<T> {
  const { apiKey, publisherId } = await getCredentials();
  const url = `${MARKETPLACE_API_URL}${endpoint}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Publisher-ID": publisherId,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Marketplace API error: ${response.status} — ${text}`);
  }
  return response.json();
}

export function registerAgentMarketplaceHandlers() {
  // Publish an agent to JoyMarketplace
  ipcMain.handle(
    "agent:publish-to-marketplace",
    async (_, payload: UnifiedPublishPayload): Promise<PublishResult> => {
      const agentId = Number(payload.sourceId);
      logger.info(`Publishing agent ${agentId} to marketplace`);

      // Fetch the full agent record
      const agent = await db.query.agents.findFirst({
        where: eq(agents.id, agentId),
      });
      if (!agent) throw new Error(`Agent not found: ${agentId}`);

      // Fetch associated tools
      const tools = await db
        .select()
        .from(agentTools)
        .where(eq(agentTools.agentId, agentId));

      // Fetch knowledge bases
      let kbs: any[] = [];
      try {
        kbs = await db
          .select()
          .from(agentKnowledgeBases)
          .where(eq(agentKnowledgeBases.agentId, agentId));
      } catch {
        // table may not exist yet
      }

      // Build the agent bundle
      const agentBundle = {
        name: agent.name,
        type: agent.type,
        systemPrompt: agent.systemPrompt,
        modelId: agent.modelId,
        temperature: agent.temperature,
        maxTokens: agent.maxTokens,
        configJson: agent.configJson,
        version: agent.version,
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          implementationCode: t.implementationCode,
          requiresApproval: t.requiresApproval,
        })),
        knowledgeBases: kbs.map((kb: any) => ({
          name: kb.name,
          type: kb.type,
          config: kb.config,
        })),
      };

      // Publish to marketplace
      const response = await publishRequest<PublishAppResponse>("/v1/assets/publish", {
        ...payload,
        assetType: "agent",
        category: payload.category || "ai-agent",
        metadata: {
          agentType: agent.type,
          modelId: agent.modelId,
          toolCount: tools.length,
          knowledgeBaseCount: kbs.length,
          hasCustomUI: !!(agent.configJson as any)?.uiComponents?.length,
        },
        bundle: agentBundle,
      });

      if (!response.success || !response.assetId) {
        throw new Error(response.message || "Failed to publish agent");
      }

      // Update local agent record with marketplace info
      await db
        .update(agents)
        .set({
          status: "published" as any,
          updatedAt: new Date(),
        })
        .where(eq(agents.id, agentId));

      // Store marketplace ID in a metadata column if available
      try {
        await db.run(
          `UPDATE agents SET publish_status = 'published', marketplace_id = '${response.assetId}', published_at = unixepoch() WHERE id = ${agentId}`
        );
      } catch {
        // columns may not exist yet before migration
      }

      logger.info(`Agent ${agentId} published as ${response.assetId}`);

      return {
        assetId: response.assetId,
        assetUrl: response.assetUrl ?? `https://joymarketplace.io/assets/${response.assetId}`,
        status: response.status,
      };
    }
  );

  // Unpublish an agent
  ipcMain.handle("agent:unpublish", async (_, agentId: number) => {
    const agent = await db.query.agents.findFirst({
      where: eq(agents.id, agentId),
    });
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    let marketplaceId: string | undefined;
    try {
      const row = await db.get<{ marketplace_id: string }>(
        `SELECT marketplace_id FROM agents WHERE id = ${agentId}`
      );
      marketplaceId = row?.marketplace_id;
    } catch {
      // column may not exist
    }

    if (marketplaceId) {
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
    }

    // Update local status
    try {
      await db.run(
        `UPDATE agents SET publish_status = 'local', marketplace_id = NULL WHERE id = ${agentId}`
      );
    } catch {
      // not critical
    }

    await db
      .update(agents)
      .set({ status: "draft" as any, updatedAt: new Date() })
      .where(eq(agents.id, agentId));

    logger.info(`Agent ${agentId} unpublished`);
  });

  // Update a published agent listing
  ipcMain.handle(
    "agent:update-listing",
    async (_, params: { agentId: number; updates: Partial<UnifiedPublishPayload> }) => {
      let marketplaceId: string | undefined;
      try {
        const row = await db.get<{ marketplace_id: string }>(
          `SELECT marketplace_id FROM agents WHERE id = ${params.agentId}`
        );
        marketplaceId = row?.marketplace_id;
      } catch {
        throw new Error("Agent has no marketplace listing");
      }

      if (!marketplaceId) {
        throw new Error("Agent has no marketplace listing");
      }

      const { apiKey, publisherId } = await getCredentials();
      const response = await fetch(
        `${MARKETPLACE_API_URL}/v1/assets/${encodeURIComponent(marketplaceId)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
            "X-Publisher-ID": publisherId,
          },
          body: JSON.stringify(params.updates),
        }
      );

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Update failed: ${response.status} — ${body}`);
      }

      return response.json();
    }
  );
}
