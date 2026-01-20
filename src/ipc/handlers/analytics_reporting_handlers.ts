/**
 * Analytics & Reporting Handlers
 * Comprehensive analytics, dashboards, and report generation
 * 
 * Features:
 * - Dataset statistics and metrics
 * - Time-series analytics
 * - Quality trend analysis
 * - Usage statistics
 * - Custom report generation
 * - Export reports in multiple formats
 * - Dashboard data aggregation
 */

import { ipcMain, app } from "electron";
import * as fs from "fs-extra";
import * as path from "path";
import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { db } from "@/db";
import { eq, inArray, and, sql, desc, asc, gte, lte, count } from "drizzle-orm";
import { datasetItems, studioDatasets, provenanceRecords } from "@/db/schema";

const logger = log.scope("analytics_reporting");

// ============================================================================
// Types
// ============================================================================

interface DatasetAnalytics {
  datasetId: string;
  datasetName: string;
  summary: {
    totalItems: number;
    totalSize: number;
    modalityDistribution: Record<string, number>;
    splitDistribution: Record<string, number>;
    sourceTypeDistribution: Record<string, number>;
  };
  quality: {
    avgQualityScore: number;
    qualityDistribution: Record<string, number>;
    lowQualityCount: number;
    highQualityCount: number;
  };
  temporal: {
    itemsCreatedByDay: Array<{ date: string; count: number }>;
    itemsCreatedByWeek: Array<{ week: string; count: number }>;
    growthRate: number;
  };
  content: {
    avgContentLength: number;
    contentLengthDistribution: Record<string, number>;
    uniqueHashCount: number;
    duplicateRate: number;
  };
  labels: {
    labeledCount: number;
    unlabeledCount: number;
    labelDistribution: Record<string, number>;
    avgLabelsPerItem: number;
  };
}

interface GlobalAnalytics {
  overview: {
    totalDatasets: number;
    totalItems: number;
    totalSizeBytes: number;
    avgItemsPerDataset: number;
  };
  storage: {
    usedBytes: number;
    contentStoreBytes: number;
    databaseBytes: number;
    backupBytes: number;
  };
  activity: {
    itemsCreatedLast24h: number;
    itemsCreatedLast7d: number;
    itemsCreatedLast30d: number;
    activeDatasets: number;
  };
  quality: {
    globalAvgQuality: number;
    qualityTrend: Array<{ date: string; avgScore: number }>;
  };
  topDatasets: Array<{
    id: string;
    name: string;
    itemCount: number;
    size: number;
  }>;
}

interface Report {
  id: string;
  name: string;
  type: "dataset" | "global" | "quality" | "custom";
  config: ReportConfig;
  generatedAt: Date;
  filePath?: string;
  status: "pending" | "generating" | "completed" | "failed";
  error?: string;
}

interface ReportConfig {
  datasetId?: string;
  dateRange?: {
    start: string;
    end: string;
  };
  sections: ReportSection[];
  format: "json" | "html" | "pdf" | "csv" | "markdown";
  includeCharts?: boolean;
  includeRawData?: boolean;
}

interface ReportSection {
  type: "summary" | "quality" | "temporal" | "content" | "labels" | "custom";
  title: string;
  config?: Record<string, any>;
}

interface DashboardWidget {
  id: string;
  type: "stat" | "chart" | "table" | "list";
  title: string;
  dataSource: string;
  config: Record<string, any>;
  position: { x: number; y: number; w: number; h: number };
}

interface Dashboard {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  createdAt: Date;
  updatedAt: Date;
}

interface TimeSeriesDataPoint {
  timestamp: Date;
  value: number;
  label?: string;
}

// ============================================================================
// Storage
// ============================================================================

const reports: Map<string, Report> = new Map();
const dashboards: Map<string, Dashboard> = new Map();
const analyticsCache: Map<string, { data: any; expires: number }> = new Map();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getAnalyticsStorageDir(): string {
  return path.join(app.getPath("userData"), "analytics");
}

async function initializeAnalyticsStorage() {
  const storageDir = getAnalyticsStorageDir();
  await fs.ensureDir(storageDir);
  await fs.ensureDir(path.join(storageDir, "reports"));
  
  // Load reports
  const reportsPath = path.join(storageDir, "reports-index.json");
  if (await fs.pathExists(reportsPath)) {
    const data = await fs.readJson(reportsPath);
    for (const r of data) {
      reports.set(r.id, { ...r, generatedAt: new Date(r.generatedAt) });
    }
  }
  
  // Load dashboards
  const dashboardsPath = path.join(storageDir, "dashboards.json");
  if (await fs.pathExists(dashboardsPath)) {
    const data = await fs.readJson(dashboardsPath);
    for (const d of data) {
      dashboards.set(d.id, {
        ...d,
        createdAt: new Date(d.createdAt),
        updatedAt: new Date(d.updatedAt),
      });
    }
  }
  
  // Initialize default dashboard if none exist
  if (dashboards.size === 0) {
    initializeDefaultDashboard();
  }
  
  logger.info(`Loaded ${reports.size} reports, ${dashboards.size} dashboards`);
}

function initializeDefaultDashboard() {
  const defaultDashboard: Dashboard = {
    id: "default",
    name: "Data Studio Overview",
    widgets: [
      {
        id: "total-items",
        type: "stat",
        title: "Total Items",
        dataSource: "global.overview.totalItems",
        config: { format: "number" },
        position: { x: 0, y: 0, w: 3, h: 2 },
      },
      {
        id: "total-datasets",
        type: "stat",
        title: "Datasets",
        dataSource: "global.overview.totalDatasets",
        config: { format: "number" },
        position: { x: 3, y: 0, w: 3, h: 2 },
      },
      {
        id: "storage-used",
        type: "stat",
        title: "Storage Used",
        dataSource: "global.storage.usedBytes",
        config: { format: "bytes" },
        position: { x: 6, y: 0, w: 3, h: 2 },
      },
      {
        id: "avg-quality",
        type: "stat",
        title: "Avg Quality",
        dataSource: "global.quality.globalAvgQuality",
        config: { format: "percent" },
        position: { x: 9, y: 0, w: 3, h: 2 },
      },
      {
        id: "items-over-time",
        type: "chart",
        title: "Items Created Over Time",
        dataSource: "global.activity.timeline",
        config: { chartType: "line" },
        position: { x: 0, y: 2, w: 6, h: 4 },
      },
      {
        id: "modality-distribution",
        type: "chart",
        title: "Modality Distribution",
        dataSource: "global.modalityDistribution",
        config: { chartType: "pie" },
        position: { x: 6, y: 2, w: 6, h: 4 },
      },
      {
        id: "top-datasets",
        type: "table",
        title: "Top Datasets",
        dataSource: "global.topDatasets",
        config: { columns: ["name", "itemCount", "size"] },
        position: { x: 0, y: 6, w: 12, h: 4 },
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  dashboards.set("default", defaultDashboard);
  saveDashboards().catch(() => {});
}

async function saveReportsIndex() {
  const storageDir = getAnalyticsStorageDir();
  await fs.writeJson(
    path.join(storageDir, "reports-index.json"),
    Array.from(reports.values()),
    { spaces: 2 }
  );
}

async function saveDashboards() {
  const storageDir = getAnalyticsStorageDir();
  await fs.writeJson(
    path.join(storageDir, "dashboards.json"),
    Array.from(dashboards.values()),
    { spaces: 2 }
  );
}

// ============================================================================
// IPC Handler Registration
// ============================================================================

export function registerAnalyticsReportingHandlers() {
  logger.info("Registering Analytics & Reporting handlers");

  app.whenReady().then(() => {
    initializeAnalyticsStorage().catch(err => {
      logger.error("Failed to initialize analytics storage:", err);
    });
  });

  // ========== Dataset Analytics ==========

  /**
   * Get dataset analytics
   */
  ipcMain.handle("analytics:dataset", async (_event, datasetId: string) => {
    try {
      // Check cache
      const cacheKey = `dataset:${datasetId}`;
      const cached = analyticsCache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        return { success: true, analytics: cached.data };
      }
      
      const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, datasetId));
      if (!dataset) throw new Error("Dataset not found");
      
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
      
      // Calculate analytics
      const analytics: DatasetAnalytics = {
        datasetId,
        datasetName: dataset.name,
        summary: calculateSummary(items),
        quality: calculateQualityMetrics(items),
        temporal: calculateTemporalMetrics(items),
        content: calculateContentMetrics(items),
        labels: calculateLabelMetrics(items),
      };
      
      // Cache result
      analyticsCache.set(cacheKey, { data: analytics, expires: Date.now() + CACHE_TTL });
      
      return { success: true, analytics };
    } catch (error) {
      logger.error("Get dataset analytics failed:", error);
      throw error;
    }
  });

  /**
   * Get global analytics
   */
  ipcMain.handle("analytics:global", async () => {
    try {
      // Check cache
      const cacheKey = "global";
      const cached = analyticsCache.get(cacheKey);
      if (cached && cached.expires > Date.now()) {
        return { success: true, analytics: cached.data };
      }
      
      const datasets = await db.select().from(studioDatasets);
      const allItems = await db.select().from(datasetItems);
      
      // Calculate storage
      const userData = app.getPath("userData");
      const contentStoreSize = await getDirectorySize(path.join(userData, "content-store"));
      const dbPath = path.join(userData, "data.db");
      const dbSize = await fs.pathExists(dbPath) ? (await fs.stat(dbPath)).size : 0;
      
      // Calculate activity
      const now = new Date();
      const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const last30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      
      const itemsLast24h = allItems.filter(i => i.createdAt >= last24h).length;
      const itemsLast7d = allItems.filter(i => i.createdAt >= last7d).length;
      const itemsLast30d = allItems.filter(i => i.createdAt >= last30d).length;
      
      // Active datasets (updated in last 7 days)
      const activeDatasets = datasets.filter(d => d.updatedAt >= last7d).length;
      
      // Quality trend
      const qualityTrend = calculateQualityTrend(allItems, 30);
      
      // Global avg quality
      let totalQuality = 0;
      let qualityCount = 0;
      for (const item of allItems) {
        if (item.qualitySignalsJson) {
          const signals = item.qualitySignalsJson as any;
          if (signals.overallScore) {
            totalQuality += signals.overallScore;
            qualityCount++;
          }
        }
      }
      
      // Top datasets
      const datasetItemCounts = new Map<string, number>();
      const datasetSizes = new Map<string, number>();
      for (const item of allItems) {
        datasetItemCounts.set(item.datasetId, (datasetItemCounts.get(item.datasetId) || 0) + 1);
        datasetSizes.set(item.datasetId, (datasetSizes.get(item.datasetId) || 0) + (item.byteSize || 0));
      }
      
      const topDatasets = datasets
        .map(d => ({
          id: d.id,
          name: d.name,
          itemCount: datasetItemCounts.get(d.id) || 0,
          size: datasetSizes.get(d.id) || 0,
        }))
        .sort((a, b) => b.itemCount - a.itemCount)
        .slice(0, 10);
      
      const analytics: GlobalAnalytics = {
        overview: {
          totalDatasets: datasets.length,
          totalItems: allItems.length,
          totalSizeBytes: allItems.reduce((sum, i) => sum + (i.byteSize || 0), 0),
          avgItemsPerDataset: datasets.length > 0 ? allItems.length / datasets.length : 0,
        },
        storage: {
          usedBytes: contentStoreSize + dbSize,
          contentStoreBytes: contentStoreSize,
          databaseBytes: dbSize,
          backupBytes: 0, // Would calculate from backup dir
        },
        activity: {
          itemsCreatedLast24h: itemsLast24h,
          itemsCreatedLast7d: itemsLast7d,
          itemsCreatedLast30d: itemsLast30d,
          activeDatasets,
        },
        quality: {
          globalAvgQuality: qualityCount > 0 ? totalQuality / qualityCount : 0,
          qualityTrend,
        },
        topDatasets,
      };
      
      // Cache result
      analyticsCache.set(cacheKey, { data: analytics, expires: Date.now() + CACHE_TTL });
      
      return { success: true, analytics };
    } catch (error) {
      logger.error("Get global analytics failed:", error);
      throw error;
    }
  });

  /**
   * Get time series data
   */
  ipcMain.handle("analytics:time-series", async (_event, args: {
    datasetId?: string;
    metric: string;
    interval: "hour" | "day" | "week" | "month";
    dateRange?: { start: string; end: string };
  }) => {
    try {
      let items;
      if (args.datasetId) {
        items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, args.datasetId));
      } else {
        items = await db.select().from(datasetItems);
      }
      
      // Apply date filter
      if (args.dateRange) {
        const start = new Date(args.dateRange.start);
        const end = new Date(args.dateRange.end);
        items = items.filter(i => i.createdAt >= start && i.createdAt <= end);
      }
      
      // Generate time series based on metric
      const series: TimeSeriesDataPoint[] = [];
      
      if (args.metric === "count") {
        const buckets = groupByInterval(items, args.interval);
        for (const [key, bucket] of Object.entries(buckets)) {
          series.push({
            timestamp: new Date(key),
            value: bucket.length,
          });
        }
      } else if (args.metric === "quality") {
        const buckets = groupByInterval(items, args.interval);
        for (const [key, bucket] of Object.entries(buckets)) {
          let total = 0;
          let count = 0;
          for (const item of bucket) {
            if (item.qualitySignalsJson) {
              const signals = item.qualitySignalsJson as any;
              if (signals.overallScore) {
                total += signals.overallScore;
                count++;
              }
            }
          }
          series.push({
            timestamp: new Date(key),
            value: count > 0 ? total / count : 0,
          });
        }
      } else if (args.metric === "size") {
        const buckets = groupByInterval(items, args.interval);
        for (const [key, bucket] of Object.entries(buckets)) {
          const totalSize = bucket.reduce((sum, i) => sum + (i.byteSize || 0), 0);
          series.push({
            timestamp: new Date(key),
            value: totalSize,
          });
        }
      }
      
      series.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      return { success: true, series };
    } catch (error) {
      logger.error("Get time series failed:", error);
      throw error;
    }
  });

  /**
   * Compare datasets
   */
  ipcMain.handle("analytics:compare-datasets", async (_event, datasetIds: string[]) => {
    try {
      const comparisons: DatasetAnalytics[] = [];
      
      for (const datasetId of datasetIds) {
        const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, datasetId));
        if (!dataset) continue;
        
        const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, datasetId));
        
        comparisons.push({
          datasetId,
          datasetName: dataset.name,
          summary: calculateSummary(items),
          quality: calculateQualityMetrics(items),
          temporal: calculateTemporalMetrics(items),
          content: calculateContentMetrics(items),
          labels: calculateLabelMetrics(items),
        });
      }
      
      return { success: true, comparisons };
    } catch (error) {
      logger.error("Compare datasets failed:", error);
      throw error;
    }
  });

  // ========== Reports ==========

  /**
   * Generate a report
   */
  ipcMain.handle("analytics:generate-report", async (_event, args: {
    name: string;
    type: Report["type"];
    config: ReportConfig;
  }) => {
    try {
      const reportId = uuidv4();
      const now = new Date();
      
      const report: Report = {
        id: reportId,
        name: args.name,
        type: args.type,
        config: args.config,
        generatedAt: now,
        status: "generating",
      };
      
      reports.set(reportId, report);
      await saveReportsIndex();
      
      // Generate report asynchronously
      generateReport(report).catch(err => {
        logger.error(`Report generation failed for ${reportId}:`, err);
        report.status = "failed";
        report.error = (err as Error).message;
        saveReportsIndex();
      });
      
      return { success: true, report };
    } catch (error) {
      logger.error("Generate report failed:", error);
      throw error;
    }
  });

  /**
   * List reports
   */
  ipcMain.handle("analytics:list-reports", async (_event, args?: {
    type?: Report["type"];
    datasetId?: string;
    limit?: number;
  }) => {
    try {
      let result = Array.from(reports.values());
      
      if (args?.type) {
        result = result.filter(r => r.type === args.type);
      }
      
      if (args?.datasetId) {
        result = result.filter(r => r.config.datasetId === args.datasetId);
      }
      
      result.sort((a, b) => b.generatedAt.getTime() - a.generatedAt.getTime());
      
      if (args?.limit) {
        result = result.slice(0, args.limit);
      }
      
      return { success: true, reports: result };
    } catch (error) {
      logger.error("List reports failed:", error);
      throw error;
    }
  });

  /**
   * Get report
   */
  ipcMain.handle("analytics:get-report", async (_event, reportId: string) => {
    try {
      const report = reports.get(reportId);
      if (!report) throw new Error("Report not found");
      
      let content: any = null;
      if (report.filePath && await fs.pathExists(report.filePath)) {
        if (report.config.format === "json") {
          content = await fs.readJson(report.filePath);
        } else {
          content = await fs.readFile(report.filePath, "utf-8");
        }
      }
      
      return { success: true, report, content };
    } catch (error) {
      logger.error("Get report failed:", error);
      throw error;
    }
  });

  /**
   * Delete report
   */
  ipcMain.handle("analytics:delete-report", async (_event, reportId: string) => {
    try {
      const report = reports.get(reportId);
      if (!report) throw new Error("Report not found");
      
      if (report.filePath && await fs.pathExists(report.filePath)) {
        await fs.remove(report.filePath);
      }
      
      reports.delete(reportId);
      await saveReportsIndex();
      
      return { success: true };
    } catch (error) {
      logger.error("Delete report failed:", error);
      throw error;
    }
  });

  // ========== Dashboards ==========

  /**
   * Get dashboard
   */
  ipcMain.handle("analytics:get-dashboard", async (_event, dashboardId?: string) => {
    try {
      const id = dashboardId || "default";
      const dashboard = dashboards.get(id);
      
      if (!dashboard) throw new Error("Dashboard not found");
      
      // Fetch data for all widgets
      const widgetData: Record<string, any> = {};
      
      // Get global analytics for dashboard
      const datasets = await db.select().from(studioDatasets);
      const allItems = await db.select().from(datasetItems);
      
      // Build data map
      const dataMap: Record<string, any> = {
        "global.overview.totalItems": allItems.length,
        "global.overview.totalDatasets": datasets.length,
        "global.storage.usedBytes": allItems.reduce((sum, i) => sum + (i.byteSize || 0), 0),
        "global.quality.globalAvgQuality": calculateGlobalAvgQuality(allItems),
        "global.topDatasets": calculateTopDatasets(datasets, allItems),
        "global.modalityDistribution": calculateModalityDistribution(allItems),
        "global.activity.timeline": calculateActivityTimeline(allItems, 30),
      };
      
      for (const widget of dashboard.widgets) {
        widgetData[widget.id] = dataMap[widget.dataSource] ?? null;
      }
      
      return { success: true, dashboard, widgetData };
    } catch (error) {
      logger.error("Get dashboard failed:", error);
      throw error;
    }
  });

  /**
   * Update dashboard
   */
  ipcMain.handle("analytics:update-dashboard", async (_event, args: {
    dashboardId: string;
    updates: Partial<Omit<Dashboard, "id" | "createdAt">>;
  }) => {
    try {
      const dashboard = dashboards.get(args.dashboardId);
      if (!dashboard) throw new Error("Dashboard not found");
      
      if (args.updates.name) dashboard.name = args.updates.name;
      if (args.updates.widgets) dashboard.widgets = args.updates.widgets;
      dashboard.updatedAt = new Date();
      
      await saveDashboards();
      
      return { success: true, dashboard };
    } catch (error) {
      logger.error("Update dashboard failed:", error);
      throw error;
    }
  });

  /**
   * Create custom dashboard
   */
  ipcMain.handle("analytics:create-dashboard", async (_event, args: {
    name: string;
    widgets: DashboardWidget[];
  }) => {
    try {
      const id = uuidv4();
      const now = new Date();
      
      const dashboard: Dashboard = {
        id,
        name: args.name,
        widgets: args.widgets.map(w => ({ ...w, id: w.id || uuidv4() })),
        createdAt: now,
        updatedAt: now,
      };
      
      dashboards.set(id, dashboard);
      await saveDashboards();
      
      return { success: true, dashboard };
    } catch (error) {
      logger.error("Create dashboard failed:", error);
      throw error;
    }
  });

  /**
   * Clear analytics cache
   */
  ipcMain.handle("analytics:clear-cache", async () => {
    try {
      analyticsCache.clear();
      return { success: true };
    } catch (error) {
      logger.error("Clear cache failed:", error);
      throw error;
    }
  });

  logger.info("Analytics & Reporting handlers registered");
}

// ============================================================================
// Analytics Calculation Functions
// ============================================================================

function calculateSummary(items: any[]): DatasetAnalytics["summary"] {
  const modalityDist: Record<string, number> = {};
  const splitDist: Record<string, number> = {};
  const sourceTypeDist: Record<string, number> = {};
  let totalSize = 0;
  
  for (const item of items) {
    modalityDist[item.modality] = (modalityDist[item.modality] || 0) + 1;
    splitDist[item.split] = (splitDist[item.split] || 0) + 1;
    sourceTypeDist[item.sourceType] = (sourceTypeDist[item.sourceType] || 0) + 1;
    totalSize += item.byteSize || 0;
  }
  
  return {
    totalItems: items.length,
    totalSize,
    modalityDistribution: modalityDist,
    splitDistribution: splitDist,
    sourceTypeDistribution: sourceTypeDist,
  };
}

function calculateQualityMetrics(items: any[]): DatasetAnalytics["quality"] {
  let totalScore = 0;
  let scoredCount = 0;
  const qualityDist: Record<string, number> = {
    "0-0.2": 0,
    "0.2-0.4": 0,
    "0.4-0.6": 0,
    "0.6-0.8": 0,
    "0.8-1.0": 0,
  };
  let lowQuality = 0;
  let highQuality = 0;
  
  for (const item of items) {
    if (item.qualitySignalsJson) {
      const signals = item.qualitySignalsJson as any;
      if (signals.overallScore !== undefined) {
        const score = signals.overallScore;
        totalScore += score;
        scoredCount++;
        
        if (score < 0.2) qualityDist["0-0.2"]++;
        else if (score < 0.4) qualityDist["0.2-0.4"]++;
        else if (score < 0.6) qualityDist["0.4-0.6"]++;
        else if (score < 0.8) qualityDist["0.6-0.8"]++;
        else qualityDist["0.8-1.0"]++;
        
        if (score < 0.5) lowQuality++;
        if (score >= 0.8) highQuality++;
      }
    }
  }
  
  return {
    avgQualityScore: scoredCount > 0 ? totalScore / scoredCount : 0,
    qualityDistribution: qualityDist,
    lowQualityCount: lowQuality,
    highQualityCount: highQuality,
  };
}

function calculateTemporalMetrics(items: any[]): DatasetAnalytics["temporal"] {
  const byDay: Record<string, number> = {};
  const byWeek: Record<string, number> = {};
  
  for (const item of items) {
    const date = new Date(item.createdAt);
    const dayKey = date.toISOString().split("T")[0];
    const weekKey = getWeekKey(date);
    
    byDay[dayKey] = (byDay[dayKey] || 0) + 1;
    byWeek[weekKey] = (byWeek[weekKey] || 0) + 1;
  }
  
  const itemsCreatedByDay = Object.entries(byDay)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
  
  const itemsCreatedByWeek = Object.entries(byWeek)
    .map(([week, count]) => ({ week, count }))
    .sort((a, b) => a.week.localeCompare(b.week));
  
  // Calculate growth rate (last 7 days vs previous 7 days)
  const now = new Date();
  const last7d = items.filter(i => 
    i.createdAt >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  ).length;
  const prev7d = items.filter(i => {
    const created = new Date(i.createdAt);
    return created >= new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000) &&
           created < new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }).length;
  
  const growthRate = prev7d > 0 ? (last7d - prev7d) / prev7d : (last7d > 0 ? 1 : 0);
  
  return {
    itemsCreatedByDay,
    itemsCreatedByWeek,
    growthRate,
  };
}

function calculateContentMetrics(items: any[]): DatasetAnalytics["content"] {
  const hashes = new Set<string>();
  let totalLength = 0;
  const lengthDist: Record<string, number> = {
    "tiny (<100)": 0,
    "small (100-1K)": 0,
    "medium (1K-10K)": 0,
    "large (10K-100K)": 0,
    "huge (>100K)": 0,
  };
  
  for (const item of items) {
    hashes.add(item.contentHash);
    const size = item.byteSize || 0;
    totalLength += size;
    
    if (size < 100) lengthDist["tiny (<100)"]++;
    else if (size < 1000) lengthDist["small (100-1K)"]++;
    else if (size < 10000) lengthDist["medium (1K-10K)"]++;
    else if (size < 100000) lengthDist["large (10K-100K)"]++;
    else lengthDist["huge (>100K)"]++;
  }
  
  return {
    avgContentLength: items.length > 0 ? totalLength / items.length : 0,
    contentLengthDistribution: lengthDist,
    uniqueHashCount: hashes.size,
    duplicateRate: items.length > 0 ? 1 - (hashes.size / items.length) : 0,
  };
}

function calculateLabelMetrics(items: any[]): DatasetAnalytics["labels"] {
  let labeledCount = 0;
  let totalLabels = 0;
  const labelDist: Record<string, number> = {};
  
  for (const item of items) {
    if (item.labelsJson) {
      const labels = item.labelsJson as any;
      const allLabels = [
        ...(labels.tags || []),
        ...(labels.categories || []),
      ];
      
      if (allLabels.length > 0) {
        labeledCount++;
        totalLabels += allLabels.length;
        
        for (const label of allLabels) {
          labelDist[label] = (labelDist[label] || 0) + 1;
        }
      }
    }
  }
  
  return {
    labeledCount,
    unlabeledCount: items.length - labeledCount,
    labelDistribution: labelDist,
    avgLabelsPerItem: labeledCount > 0 ? totalLabels / labeledCount : 0,
  };
}

function calculateQualityTrend(items: any[], days: number): Array<{ date: string; avgScore: number }> {
  const now = new Date();
  const buckets: Record<string, { total: number; count: number }> = {};
  
  for (const item of items) {
    const created = new Date(item.createdAt);
    if (created >= new Date(now.getTime() - days * 24 * 60 * 60 * 1000)) {
      const dateKey = created.toISOString().split("T")[0];
      
      if (item.qualitySignalsJson) {
        const signals = item.qualitySignalsJson as any;
        if (signals.overallScore !== undefined) {
          if (!buckets[dateKey]) {
            buckets[dateKey] = { total: 0, count: 0 };
          }
          buckets[dateKey].total += signals.overallScore;
          buckets[dateKey].count++;
        }
      }
    }
  }
  
  return Object.entries(buckets)
    .map(([date, { total, count }]) => ({
      date,
      avgScore: count > 0 ? total / count : 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function calculateGlobalAvgQuality(items: any[]): number {
  let total = 0;
  let count = 0;
  
  for (const item of items) {
    if (item.qualitySignalsJson) {
      const signals = item.qualitySignalsJson as any;
      if (signals.overallScore !== undefined) {
        total += signals.overallScore;
        count++;
      }
    }
  }
  
  return count > 0 ? total / count : 0;
}

function calculateTopDatasets(datasets: any[], items: any[]): any[] {
  const countByDataset = new Map<string, number>();
  const sizeByDataset = new Map<string, number>();
  
  for (const item of items) {
    countByDataset.set(item.datasetId, (countByDataset.get(item.datasetId) || 0) + 1);
    sizeByDataset.set(item.datasetId, (sizeByDataset.get(item.datasetId) || 0) + (item.byteSize || 0));
  }
  
  return datasets
    .map(d => ({
      id: d.id,
      name: d.name,
      itemCount: countByDataset.get(d.id) || 0,
      size: sizeByDataset.get(d.id) || 0,
    }))
    .sort((a, b) => b.itemCount - a.itemCount)
    .slice(0, 10);
}

function calculateModalityDistribution(items: any[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const item of items) {
    dist[item.modality] = (dist[item.modality] || 0) + 1;
  }
  return dist;
}

function calculateActivityTimeline(items: any[], days: number): Array<{ date: string; count: number }> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const byDate: Record<string, number> = {};
  
  for (const item of items) {
    const created = new Date(item.createdAt);
    if (created >= cutoff) {
      const dateKey = created.toISOString().split("T")[0];
      byDate[dateKey] = (byDate[dateKey] || 0) + 1;
    }
  }
  
  return Object.entries(byDate)
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================================
// Report Generation
// ============================================================================

async function generateReport(report: Report): Promise<void> {
  try {
    const reportDir = path.join(getAnalyticsStorageDir(), "reports");
    await fs.ensureDir(reportDir);
    
    // Gather data based on report type
    let data: any = {};
    
    if (report.type === "dataset" && report.config.datasetId) {
      const [dataset] = await db.select().from(studioDatasets).where(eq(studioDatasets.id, report.config.datasetId));
      const items = await db.select().from(datasetItems).where(eq(datasetItems.datasetId, report.config.datasetId));
      
      data = {
        dataset,
        analytics: {
          summary: calculateSummary(items),
          quality: calculateQualityMetrics(items),
          temporal: calculateTemporalMetrics(items),
          content: calculateContentMetrics(items),
          labels: calculateLabelMetrics(items),
        },
        generatedAt: new Date().toISOString(),
      };
    } else if (report.type === "global") {
      const datasets = await db.select().from(studioDatasets);
      const items = await db.select().from(datasetItems);
      
      data = {
        overview: {
          totalDatasets: datasets.length,
          totalItems: items.length,
          totalSize: items.reduce((sum, i) => sum + (i.byteSize || 0), 0),
        },
        datasetSummaries: datasets.map(d => {
          const datasetItems_ = items.filter(i => i.datasetId === d.id);
          return {
            id: d.id,
            name: d.name,
            itemCount: datasetItems_.length,
            ...calculateSummary(datasetItems_),
          };
        }),
        generatedAt: new Date().toISOString(),
      };
    }
    
    // Generate output based on format
    let outputPath: string;
    let outputContent: string;
    
    switch (report.config.format) {
      case "json":
        outputPath = path.join(reportDir, `${report.id}.json`);
        await fs.writeJson(outputPath, data, { spaces: 2 });
        break;
      
      case "markdown":
        outputPath = path.join(reportDir, `${report.id}.md`);
        outputContent = generateMarkdownReport(report, data);
        await fs.writeFile(outputPath, outputContent);
        break;
      
      case "html":
        outputPath = path.join(reportDir, `${report.id}.html`);
        outputContent = generateHtmlReport(report, data);
        await fs.writeFile(outputPath, outputContent);
        break;
      
      case "csv":
        outputPath = path.join(reportDir, `${report.id}.csv`);
        outputContent = generateCsvReport(report, data);
        await fs.writeFile(outputPath, outputContent);
        break;
      
      default:
        outputPath = path.join(reportDir, `${report.id}.json`);
        await fs.writeJson(outputPath, data, { spaces: 2 });
    }
    
    report.filePath = outputPath;
    report.status = "completed";
    await saveReportsIndex();
    
  } catch (error) {
    report.status = "failed";
    report.error = (error as Error).message;
    await saveReportsIndex();
    throw error;
  }
}

function generateMarkdownReport(report: Report, data: any): string {
  let md = `# ${report.name}\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;
  
  if (data.dataset) {
    md += `## Dataset: ${data.dataset.name}\n\n`;
  }
  
  if (data.analytics?.summary) {
    const s = data.analytics.summary;
    md += `## Summary\n\n`;
    md += `- **Total Items**: ${s.totalItems}\n`;
    md += `- **Total Size**: ${formatBytes(s.totalSize)}\n\n`;
    
    md += `### Modality Distribution\n\n`;
    md += `| Modality | Count |\n|----------|-------|\n`;
    for (const [mod, count] of Object.entries(s.modalityDistribution)) {
      md += `| ${mod} | ${count} |\n`;
    }
    md += `\n`;
  }
  
  if (data.analytics?.quality) {
    const q = data.analytics.quality;
    md += `## Quality Metrics\n\n`;
    md += `- **Average Quality Score**: ${(q.avgQualityScore * 100).toFixed(1)}%\n`;
    md += `- **High Quality Items**: ${q.highQualityCount}\n`;
    md += `- **Low Quality Items**: ${q.lowQualityCount}\n\n`;
  }
  
  return md;
}

function generateHtmlReport(report: Report, data: any): string {
  let html = `<!DOCTYPE html>
<html>
<head>
  <title>${report.name}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; }
    h1 { color: #333; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background-color: #4CAF50; color: white; }
    .stat { font-size: 24px; font-weight: bold; color: #2196F3; }
  </style>
</head>
<body>
  <h1>${report.name}</h1>
  <p>Generated: ${new Date().toISOString()}</p>
`;

  if (data.analytics?.summary) {
    const s = data.analytics.summary;
    html += `
  <h2>Summary</h2>
  <p><span class="stat">${s.totalItems}</span> Total Items</p>
  <p><span class="stat">${formatBytes(s.totalSize)}</span> Total Size</p>
`;
  }
  
  html += `</body></html>`;
  return html;
}

function generateCsvReport(report: Report, data: any): string {
  const lines: string[] = [];
  
  if (data.datasetSummaries) {
    lines.push("dataset_id,name,item_count,total_size");
    for (const d of data.datasetSummaries) {
      lines.push(`${d.id},${d.name},${d.itemCount},${d.totalSize}`);
    }
  } else if (data.analytics) {
    lines.push("metric,value");
    lines.push(`total_items,${data.analytics.summary?.totalItems || 0}`);
    lines.push(`total_size,${data.analytics.summary?.totalSize || 0}`);
    lines.push(`avg_quality,${data.analytics.quality?.avgQualityScore || 0}`);
  }
  
  return lines.join("\n");
}

// ============================================================================
// Helper Functions
// ============================================================================

function getWeekKey(date: Date): string {
  const year = date.getFullYear();
  const oneJan = new Date(year, 0, 1);
  const weekNum = Math.ceil((((date.getTime() - oneJan.getTime()) / 86400000) + oneJan.getDay() + 1) / 7);
  return `${year}-W${weekNum.toString().padStart(2, "0")}`;
}

function groupByInterval(items: any[], interval: string): Record<string, any[]> {
  const buckets: Record<string, any[]> = {};
  
  for (const item of items) {
    const date = new Date(item.createdAt);
    let key: string;
    
    switch (interval) {
      case "hour":
        key = `${date.toISOString().split("T")[0]}T${date.getHours().toString().padStart(2, "0")}:00`;
        break;
      case "day":
        key = date.toISOString().split("T")[0];
        break;
      case "week":
        key = getWeekKey(date);
        break;
      case "month":
        key = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, "0")}`;
        break;
      default:
        key = date.toISOString().split("T")[0];
    }
    
    if (!buckets[key]) {
      buckets[key] = [];
    }
    buckets[key].push(item);
  }
  
  return buckets;
}

async function getDirectorySize(dirPath: string): Promise<number> {
  if (!await fs.pathExists(dirPath)) return 0;
  
  let totalSize = 0;
  
  async function processDir(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await processDir(fullPath);
      } else {
        const stats = await fs.stat(fullPath);
        totalSize += stats.size;
      }
    }
  }
  
  await processDir(dirPath);
  return totalSize;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}
