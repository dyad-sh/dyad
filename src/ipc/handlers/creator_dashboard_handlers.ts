/**
 * Creator Dashboard IPC Handlers
 * Aggregates data across all asset types for the unified creator dashboard
 */

import { ipcMain, app } from "electron";
import { db } from "@/db";
import { apps, agents } from "@/db/schema";
import { count, sql } from "drizzle-orm";
import log from "electron-log";
import * as fs from "fs-extra";
import * as path from "path";
import type {
  CreatorOverview,
  CreatorAssetRecord,
  EarningsBreakdown,
  CreatorAnalytics,
  PublishableAssetType,
} from "@/types/publish_types";
import { JOYMARKETPLACE_API } from "@/config/joymarketplace";

const logger = log.scope("creator_dashboard");

const MARKETPLACE_API_URL = JOYMARKETPLACE_API.baseUrl;

async function getApiKey(): Promise<string | null> {
  try {
    const credPath = path.join(
      app.getPath("userData"),
      "marketplace-credentials.json"
    );
    if (await fs.pathExists(credPath)) {
      const data = await fs.readJson(credPath);
      return data?.apiKey ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}

async function authenticatedRequest<T>(endpoint: string): Promise<T | null> {
  const apiKey = await getApiKey();
  if (!apiKey) return null;

  try {
    const response = await fetch(`${MARKETPLACE_API_URL}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  }
}

export function registerCreatorDashboardHandlers() {
  // Get overview: counts of local assets + marketplace earnings
  ipcMain.handle("creator:get-overview", async (): Promise<CreatorOverview> => {
    logger.info("Fetching creator overview");

    // Aggregate local counts
    const [appCount] = await db.select({ value: count() }).from(apps);
    const [agentCount] = await db.select({ value: count() }).from(agents);

    // Datasets & models — count from their respective tables if they exist
    let datasetCountValue = 0;
    let modelCountValue = 0;
    try {
      const dsResult = await db.all<{ c: number }>(
        sql`SELECT count(*) as c FROM studio_datasets`
      );
      datasetCountValue = dsResult[0]?.c ?? 0;
    } catch {
      // table may not exist
    }
    try {
      const mResult = await db.all<{ c: number }>(
        sql`SELECT count(*) as c FROM model_registry_entries`
      );
      modelCountValue = mResult[0]?.c ?? 0;
    } catch {
      // table may not exist
    }

    // Fetch marketplace earnings (best-effort)
    let publishedCount = 0;
    let totalEarnings = 0;
    let thisMonthEarnings = 0;
    const earningsData = await authenticatedRequest<{
      totalEarnings?: number;
      thisMonth?: number;
      salesCount?: number;
    }>("/v1/publisher/earnings");
    if (earningsData) {
      totalEarnings = earningsData.totalEarnings ?? 0;
      thisMonthEarnings = earningsData.thisMonth ?? 0;
    }

    const assetsData = await authenticatedRequest<{ id: string }[]>(
      "/v1/publisher/assets"
    );
    if (assetsData) {
      publishedCount = assetsData.length;
    }

    // Workflow count from n8n workflow storage
    let workflowCountValue = 0;
    const workflowDir = path.join(app.getPath("userData"), "n8n-workflows");
    if (await fs.pathExists(workflowDir)) {
      const files = await fs.readdir(workflowDir);
      workflowCountValue = files.filter((f) => f.endsWith(".json")).length;
    }

    return {
      totalApps: appCount.value,
      totalAgents: agentCount.value,
      totalWorkflows: workflowCountValue,
      totalDatasets: datasetCountValue,
      totalModels: modelCountValue,
      publishedCount,
      totalEarnings,
      thisMonthEarnings,
    };
  });

  // Get unified list of all created assets
  ipcMain.handle("creator:get-all-assets", async (): Promise<CreatorAssetRecord[]> => {
    const records: CreatorAssetRecord[] = [];

    // Apps
    const allApps = await db.select().from(apps);
    for (const a of allApps) {
      records.push({
        id: String(a.id),
        name: a.name,
        assetType: "app",
        publishStatus: "local",
        createdAt: a.createdAt
          ? new Date(Number(a.createdAt) * 1000).toISOString()
          : new Date().toISOString(),
        updatedAt: a.updatedAt
          ? new Date(Number(a.updatedAt) * 1000).toISOString()
          : new Date().toISOString(),
      });
    }

    // Agents
    const allAgents = await db.select().from(agents);
    for (const a of allAgents) {
      records.push({
        id: String(a.id),
        name: a.name,
        assetType: "agent",
        publishStatus: (a as any).publishStatus ?? "local",
        marketplaceId: (a as any).marketplaceId ?? undefined,
        createdAt: a.createdAt
          ? new Date(Number(a.createdAt) * 1000).toISOString()
          : new Date().toISOString(),
        updatedAt: a.updatedAt
          ? new Date(Number(a.updatedAt) * 1000).toISOString()
          : new Date().toISOString(),
      });
    }

    // Datasets
    try {
      const datasets = await db.all<{
        id: number;
        name: string;
        publish_status: string;
        marketplace_id: string;
        created_at: number;
        updated_at: number;
      }>(
        sql`SELECT id, name, publish_status, marketplace_id, created_at, updated_at FROM studio_datasets`
      );
      for (const d of datasets) {
        records.push({
          id: String(d.id),
          name: d.name,
          assetType: "dataset",
          publishStatus: (d.publish_status as any) ?? "local",
          marketplaceId: d.marketplace_id ?? undefined,
          createdAt: new Date(d.created_at * 1000).toISOString(),
          updatedAt: new Date(d.updated_at * 1000).toISOString(),
        });
      }
    } catch {
      // table may not exist
    }

    // Models
    try {
      const models = await db.all<{
        id: string;
        name: string;
        publish_status: string;
        created_at: number;
        updated_at: number;
      }>(
        sql`SELECT id, name, publish_status, created_at, updated_at FROM model_registry_entries`
      );
      for (const m of models) {
        records.push({
          id: m.id,
          name: m.name,
          assetType: "model",
          publishStatus: (m.publish_status as any) ?? "local",
          createdAt: new Date(m.created_at * 1000).toISOString(),
          updatedAt: new Date(m.updated_at * 1000).toISOString(),
        });
      }
    } catch {
      // table may not exist
    }

    // Sort by most recently updated first
    records.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return records;
  });

  // Get earnings breakdown
  ipcMain.handle(
    "creator:get-earnings-breakdown",
    async (): Promise<EarningsBreakdown> => {
      const earnings = await authenticatedRequest<EarningsBreakdown>(
        "/v1/publisher/earnings/breakdown"
      );
      return (
        earnings ?? {
          totalEarnings: 0,
          thisMonth: 0,
          lastMonth: 0,
          pendingPayout: 0,
          byAsset: [],
          byMonth: [],
        }
      );
    }
  );

  // Get analytics
  ipcMain.handle(
    "creator:get-analytics",
    async (): Promise<CreatorAnalytics> => {
      const analytics = await authenticatedRequest<CreatorAnalytics>(
        "/v1/publisher/analytics"
      );
      return (
        analytics ?? {
          totalDownloads: 0,
          totalInstalls: 0,
          averageRating: 0,
          totalReviews: 0,
          topAssets: [],
        }
      );
    }
  );
}
