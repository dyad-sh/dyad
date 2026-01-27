/**
 * Self-hosted Analytics Service
 * Privacy-preserving analytics without third-party services.
 * All data stays local with optional P2P aggregation.
 */

import * as crypto from "crypto";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { app } from "electron";
import log from "electron-log";
import { EventEmitter } from "events";
import Database from "better-sqlite3";

import type {
  AnalyticsEvent,
  AnalyticsMetric,
  Dashboard,
  DashboardWidget,
  TimeRange,
  AggregatedData,
  UserBehavior,
  PerformanceMetric,
} from "@/types/sovereign_stack_types";

const logger = log.scope("self_hosted_analytics");

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_ANALYTICS_DIR = path.join(app.getPath("userData"), "analytics");
const DB_NAME = "analytics.db";

// Event categories
const EVENT_CATEGORIES = {
  PAGE_VIEW: "page_view",
  FEATURE_USE: "feature_use",
  ERROR: "error",
  PERFORMANCE: "performance",
  USER_ACTION: "user_action",
  SYSTEM: "system",
  CUSTOM: "custom",
} as const;

// Aggregation intervals
const AGGREGATION_INTERVALS = ["minute", "hour", "day", "week", "month"] as const;

// =============================================================================
// SELF-HOSTED ANALYTICS SERVICE
// =============================================================================

export class SelfHostedAnalytics extends EventEmitter {
  private analyticsDir: string;
  private db: Database.Database | null = null;
  private sessionId: string;
  private userId: string;
  private eventBuffer: AnalyticsEvent[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private dashboards: Map<string, Dashboard> = new Map();
  private retentionDays: number = 365;
  
  constructor(analyticsDir?: string) {
    super();
    this.analyticsDir = analyticsDir || DEFAULT_ANALYTICS_DIR;
    this.sessionId = crypto.randomUUID();
    this.userId = this.getOrCreateUserId();
  }
  
  private getOrCreateUserId(): string {
    // Use a hash of machine ID for privacy
    const machineId = app.getPath("userData");
    return crypto.createHash("sha256").update(machineId).digest("hex").substring(0, 16);
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    logger.info("Initializing self-hosted analytics", { dir: this.analyticsDir });
    
    await fs.mkdir(this.analyticsDir, { recursive: true });
    
    // Initialize database
    const dbPath = path.join(this.analyticsDir, DB_NAME);
    this.db = new Database(dbPath);
    
    await this.createTables();
    await this.loadDashboards();
    
    // Start event buffer flush
    this.flushInterval = setInterval(() => this.flushEventBuffer(), 10000);
    
    // Track session start
    this.trackEvent({
      category: "system",
      action: "session_start",
      metadata: {
        platform: process.platform,
        arch: process.arch,
        version: app.getVersion(),
      },
    });
    
    logger.info("Self-hosted analytics initialized");
  }
  
  private async createTables(): Promise<void> {
    if (!this.db) return;
    
    // Events table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        label TEXT,
        value REAL,
        metadata TEXT,
        timestamp INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );
      
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
      CREATE INDEX IF NOT EXISTS idx_events_action ON events(action);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
    `);
    
    // Metrics table (pre-aggregated data)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        value REAL NOT NULL,
        tags TEXT,
        interval TEXT NOT NULL,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        count INTEGER DEFAULT 1,
        sum REAL,
        min REAL,
        max REAL,
        avg REAL,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );
      
      CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(name);
      CREATE INDEX IF NOT EXISTS idx_metrics_period ON metrics(period_start, period_end);
    `);
    
    // Performance metrics table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS performance (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        metric_name TEXT NOT NULL,
        value REAL NOT NULL,
        unit TEXT,
        context TEXT,
        timestamp INTEGER NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_perf_metric ON performance(metric_name);
      CREATE INDEX IF NOT EXISTS idx_perf_timestamp ON performance(timestamp);
    `);
    
    // User behavior table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_behavior (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        feature TEXT NOT NULL,
        usage_count INTEGER DEFAULT 1,
        total_duration INTEGER DEFAULT 0,
        last_used INTEGER,
        first_used INTEGER,
        metadata TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_behavior_user ON user_behavior(user_id);
      CREATE INDEX IF NOT EXISTS idx_behavior_feature ON user_behavior(feature);
    `);
    
    // Dashboards table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS dashboards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        widgets TEXT NOT NULL,
        layout TEXT,
        is_default INTEGER DEFAULT 0,
        metadata TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000),
        updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
      );
    `);
  }
  
  private async loadDashboards(): Promise<void> {
    if (!this.db) return;
    
    const rows = this.db.prepare("SELECT * FROM dashboards").all() as Array<{
      id: string;
      name: string;
      description: string;
      widgets: string;
      layout: string;
      is_default: number;
      metadata: string;
      created_at: number;
      updated_at: number;
    }>;
    
    for (const row of rows) {
      this.dashboards.set(row.id, {
        id: row.id,
        name: row.name,
        description: row.description,
        widgets: JSON.parse(row.widgets),
        layout: row.layout ? JSON.parse(row.layout) : undefined,
        isDefault: row.is_default === 1,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    }
    
    // Create default dashboard if none exists
    if (this.dashboards.size === 0) {
      await this.createDefaultDashboard();
    }
  }
  
  private async createDefaultDashboard(): Promise<void> {
    const dashboard: Dashboard = {
      id: "default",
      name: "Overview",
      description: "Default analytics dashboard",
      widgets: [
        {
          id: "sessions",
          type: "metric",
          title: "Active Sessions",
          metric: "session_count",
          timeRange: { start: Date.now() - 7 * 24 * 60 * 60 * 1000, end: Date.now() },
          size: { width: 2, height: 1 },
          position: { x: 0, y: 0 },
        },
        {
          id: "events",
          type: "chart",
          title: "Events Over Time",
          chartType: "line",
          metric: "event_count",
          timeRange: { start: Date.now() - 7 * 24 * 60 * 60 * 1000, end: Date.now() },
          groupBy: "day",
          size: { width: 4, height: 2 },
          position: { x: 2, y: 0 },
        },
        {
          id: "features",
          type: "chart",
          title: "Feature Usage",
          chartType: "bar",
          metric: "feature_usage",
          timeRange: { start: Date.now() - 30 * 24 * 60 * 60 * 1000, end: Date.now() },
          size: { width: 3, height: 2 },
          position: { x: 0, y: 1 },
        },
        {
          id: "performance",
          type: "chart",
          title: "Performance Metrics",
          chartType: "area",
          metric: "performance",
          timeRange: { start: Date.now() - 24 * 60 * 60 * 1000, end: Date.now() },
          size: { width: 3, height: 2 },
          position: { x: 3, y: 1 },
        },
      ],
      isDefault: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    await this.saveDashboard(dashboard);
  }
  
  // ===========================================================================
  // EVENT TRACKING
  // ===========================================================================
  
  trackEvent(params: {
    category: string;
    action: string;
    label?: string;
    value?: number;
    metadata?: Record<string, unknown>;
  }): void {
    const event: AnalyticsEvent = {
      id: crypto.randomUUID(),
      sessionId: this.sessionId,
      userId: this.userId,
      category: params.category,
      action: params.action,
      label: params.label,
      value: params.value,
      metadata: params.metadata,
      timestamp: Date.now(),
    };
    
    this.eventBuffer.push(event);
    this.emit("event", event);
    
    // Auto-flush if buffer is large
    if (this.eventBuffer.length >= 100) {
      this.flushEventBuffer();
    }
  }
  
  trackPageView(page: string, metadata?: Record<string, unknown>): void {
    this.trackEvent({
      category: EVENT_CATEGORIES.PAGE_VIEW,
      action: "view",
      label: page,
      metadata,
    });
  }
  
  trackFeatureUse(feature: string, duration?: number, metadata?: Record<string, unknown>): void {
    this.trackEvent({
      category: EVENT_CATEGORIES.FEATURE_USE,
      action: "use",
      label: feature,
      value: duration,
      metadata,
    });
    
    // Update user behavior
    this.updateUserBehavior(feature, duration);
  }
  
  trackError(error: Error | string, context?: Record<string, unknown>): void {
    const errorMessage = error instanceof Error ? error.message : error;
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    this.trackEvent({
      category: EVENT_CATEGORIES.ERROR,
      action: "error",
      label: errorMessage,
      metadata: {
        stack: errorStack,
        ...context,
      },
    });
  }
  
  trackPerformance(metric: PerformanceMetric): void {
    if (!this.db) return;
    
    const stmt = this.db.prepare(`
      INSERT INTO performance (id, session_id, metric_name, value, unit, context, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      crypto.randomUUID(),
      this.sessionId,
      metric.name,
      metric.value,
      metric.unit || null,
      metric.context ? JSON.stringify(metric.context) : null,
      Date.now()
    );
    
    this.emit("performance", metric);
  }
  
  private updateUserBehavior(feature: string, duration?: number): void {
    if (!this.db) return;
    
    const existing = this.db.prepare(`
      SELECT * FROM user_behavior 
      WHERE user_id = ? AND feature = ?
    `).get(this.userId, feature) as {
      id: string;
      usage_count: number;
      total_duration: number;
    } | undefined;
    
    const now = Date.now();
    
    if (existing) {
      this.db.prepare(`
        UPDATE user_behavior 
        SET usage_count = usage_count + 1,
            total_duration = total_duration + ?,
            last_used = ?
        WHERE id = ?
      `).run(duration || 0, now, existing.id);
    } else {
      this.db.prepare(`
        INSERT INTO user_behavior (id, user_id, session_id, feature, usage_count, total_duration, last_used, first_used)
        VALUES (?, ?, ?, ?, 1, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        this.userId,
        this.sessionId,
        feature,
        duration || 0,
        now,
        now
      );
    }
  }
  
  private flushEventBuffer(): void {
    if (!this.db || this.eventBuffer.length === 0) return;
    
    const events = [...this.eventBuffer];
    this.eventBuffer = [];
    
    const stmt = this.db.prepare(`
      INSERT INTO events (id, session_id, user_id, category, action, label, value, metadata, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    const insertMany = this.db.transaction((events: AnalyticsEvent[]) => {
      for (const event of events) {
        stmt.run(
          event.id,
          event.sessionId,
          event.userId,
          event.category,
          event.action,
          event.label || null,
          event.value || null,
          event.metadata ? JSON.stringify(event.metadata) : null,
          event.timestamp
        );
      }
    });
    
    try {
      insertMany(events);
    } catch (error) {
      logger.error("Failed to flush event buffer", { error });
      // Re-add events to buffer on failure
      this.eventBuffer.push(...events);
    }
  }
  
  // ===========================================================================
  // METRICS & AGGREGATION
  // ===========================================================================
  
  async recordMetric(params: {
    name: string;
    value: number;
    tags?: Record<string, string>;
    interval?: typeof AGGREGATION_INTERVALS[number];
  }): Promise<void> {
    if (!this.db) return;
    
    const interval = params.interval || "hour";
    const { start, end } = this.getPeriodBounds(Date.now(), interval);
    
    const existing = this.db.prepare(`
      SELECT * FROM metrics 
      WHERE name = ? AND period_start = ? AND tags = ?
    `).get(
      params.name,
      start,
      params.tags ? JSON.stringify(params.tags) : null
    ) as {
      id: string;
      count: number;
      sum: number;
      min: number;
      max: number;
    } | undefined;
    
    if (existing) {
      const newCount = existing.count + 1;
      const newSum = existing.sum + params.value;
      const newMin = Math.min(existing.min, params.value);
      const newMax = Math.max(existing.max, params.value);
      const newAvg = newSum / newCount;
      
      this.db.prepare(`
        UPDATE metrics 
        SET count = ?, sum = ?, min = ?, max = ?, avg = ?, value = ?
        WHERE id = ?
      `).run(newCount, newSum, newMin, newMax, newAvg, newAvg, existing.id);
    } else {
      this.db.prepare(`
        INSERT INTO metrics (id, name, value, tags, interval, period_start, period_end, count, sum, min, max, avg)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        params.name,
        params.value,
        params.tags ? JSON.stringify(params.tags) : null,
        interval,
        start,
        end,
        params.value,
        params.value,
        params.value,
        params.value
      );
    }
  }
  
  private getPeriodBounds(timestamp: number, interval: string): { start: number; end: number } {
    const date = new Date(timestamp);
    let start: Date;
    let end: Date;
    
    switch (interval) {
      case "minute":
        start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes());
        end = new Date(start.getTime() + 60 * 1000);
        break;
      case "hour":
        start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());
        end = new Date(start.getTime() + 60 * 60 * 1000);
        break;
      case "day":
        start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        break;
      case "week":
        const dayOfWeek = date.getDay();
        start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - dayOfWeek);
        end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
        break;
      case "month":
        start = new Date(date.getFullYear(), date.getMonth(), 1);
        end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
        break;
      default:
        start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    }
    
    return { start: start.getTime(), end: end.getTime() };
  }
  
  // ===========================================================================
  // QUERIES
  // ===========================================================================
  
  queryEvents(params: {
    timeRange: TimeRange;
    category?: string;
    action?: string;
    limit?: number;
    offset?: number;
  }): AnalyticsEvent[] {
    if (!this.db) return [];
    
    let query = `
      SELECT * FROM events 
      WHERE timestamp >= ? AND timestamp <= ?
    `;
    const queryParams: (string | number)[] = [params.timeRange.start, params.timeRange.end];
    
    if (params.category) {
      query += " AND category = ?";
      queryParams.push(params.category);
    }
    
    if (params.action) {
      query += " AND action = ?";
      queryParams.push(params.action);
    }
    
    query += " ORDER BY timestamp DESC";
    
    if (params.limit) {
      query += " LIMIT ?";
      queryParams.push(params.limit);
    }
    
    if (params.offset) {
      query += " OFFSET ?";
      queryParams.push(params.offset);
    }
    
    const rows = this.db.prepare(query).all(...queryParams) as Array<{
      id: string;
      session_id: string;
      user_id: string;
      category: string;
      action: string;
      label: string | null;
      value: number | null;
      metadata: string | null;
      timestamp: number;
    }>;
    
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      userId: row.user_id,
      category: row.category,
      action: row.action,
      label: row.label || undefined,
      value: row.value || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      timestamp: row.timestamp,
    }));
  }
  
  aggregateEvents(params: {
    timeRange: TimeRange;
    groupBy: typeof AGGREGATION_INTERVALS[number];
    category?: string;
    action?: string;
  }): AggregatedData[] {
    if (!this.db) return [];
    
    const { start, end } = params.timeRange;
    const buckets: Map<number, AggregatedData> = new Map();
    
    // Generate time buckets
    let current = this.getPeriodBounds(start, params.groupBy).start;
    while (current < end) {
      buckets.set(current, {
        periodStart: current,
        periodEnd: this.getPeriodBounds(current, params.groupBy).end,
        count: 0,
        values: {},
      });
      current = this.getPeriodBounds(current, params.groupBy).end;
    }
    
    // Query events
    let query = `
      SELECT category, action, COUNT(*) as count, timestamp 
      FROM events 
      WHERE timestamp >= ? AND timestamp <= ?
    `;
    const queryParams: (string | number)[] = [start, end];
    
    if (params.category) {
      query += " AND category = ?";
      queryParams.push(params.category);
    }
    
    if (params.action) {
      query += " AND action = ?";
      queryParams.push(params.action);
    }
    
    query += " GROUP BY category, action";
    
    const rows = this.db.prepare(query).all(...queryParams) as Array<{
      category: string;
      action: string;
      count: number;
      timestamp: number;
    }>;
    
    // Fill buckets
    for (const row of rows) {
      const bucketStart = this.getPeriodBounds(row.timestamp, params.groupBy).start;
      const bucket = buckets.get(bucketStart);
      if (bucket) {
        bucket.count = (bucket.count || 0) + row.count;
        const key = `${row.category}:${row.action}`;
        if (!bucket.values) bucket.values = {};
        bucket.values[key] = (bucket.values[key] || 0) + row.count;
      }
    }
    
    return Array.from(buckets.values());
  }
  
  getMetrics(params: {
    name: string;
    timeRange: TimeRange;
    interval?: typeof AGGREGATION_INTERVALS[number];
    tags?: Record<string, string>;
  }): AnalyticsMetric[] {
    if (!this.db) return [];
    
    let query = `
      SELECT * FROM metrics 
      WHERE name = ? AND period_start >= ? AND period_end <= ?
    `;
    const queryParams: (string | number | null)[] = [params.name, params.timeRange.start, params.timeRange.end];
    
    if (params.interval) {
      query += " AND interval = ?";
      queryParams.push(params.interval);
    }
    
    if (params.tags) {
      query += " AND tags = ?";
      queryParams.push(JSON.stringify(params.tags));
    }
    
    query += " ORDER BY period_start ASC";
    
    const rows = this.db.prepare(query).all(...queryParams) as Array<{
      id: string;
      name: string;
      value: number;
      tags: string | null;
      interval: string;
      period_start: number;
      period_end: number;
      count: number;
      sum: number;
      min: number;
      max: number;
      avg: number;
    }>;
    
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      value: row.value,
      tags: row.tags ? JSON.parse(row.tags) : undefined,
      interval: row.interval as typeof AGGREGATION_INTERVALS[number],
      periodStart: row.period_start,
      periodEnd: row.period_end,
      count: row.count,
      sum: row.sum,
      min: row.min,
      max: row.max,
      avg: row.avg,
    }));
  }
  
  getUserBehavior(userId?: string): UserBehavior[] {
    if (!this.db) return [];
    
    const query = userId
      ? "SELECT * FROM user_behavior WHERE user_id = ? ORDER BY usage_count DESC"
      : "SELECT * FROM user_behavior ORDER BY usage_count DESC";
    
    const rows = (userId
      ? this.db.prepare(query).all(userId)
      : this.db.prepare(query).all()) as Array<{
      id: string;
      user_id: string;
      session_id: string;
      feature: string;
      usage_count: number;
      total_duration: number;
      last_used: number;
      first_used: number;
      metadata: string | null;
    }>;
    
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      sessionId: row.session_id,
      feature: row.feature,
      usageCount: row.usage_count,
      totalDuration: row.total_duration,
      lastUsed: row.last_used,
      firstUsed: row.first_used,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    }));
  }
  
  getPerformanceMetrics(params: {
    metricName?: string;
    timeRange: TimeRange;
  }): PerformanceMetric[] {
    if (!this.db) return [];
    
    let query = `
      SELECT * FROM performance 
      WHERE timestamp >= ? AND timestamp <= ?
    `;
    const queryParams: (string | number)[] = [params.timeRange.start, params.timeRange.end];
    
    if (params.metricName) {
      query += " AND metric_name = ?";
      queryParams.push(params.metricName);
    }
    
    query += " ORDER BY timestamp DESC";
    
    const rows = this.db.prepare(query).all(...queryParams) as Array<{
      id: string;
      session_id: string;
      metric_name: string;
      value: number;
      unit: string | null;
      context: string | null;
      timestamp: number;
    }>;
    
    return rows.map((row) => ({
      name: row.metric_name,
      value: row.value,
      unit: row.unit || undefined,
      context: row.context ? JSON.parse(row.context) : undefined,
      timestamp: row.timestamp,
    }));
  }
  
  // ===========================================================================
  // DASHBOARDS
  // ===========================================================================
  
  async createDashboard(params: {
    name: string;
    description?: string;
    widgets: DashboardWidget[];
    layout?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<Dashboard> {
    const dashboard: Dashboard = {
      id: crypto.randomUUID(),
      name: params.name,
      description: params.description,
      widgets: params.widgets,
      layout: params.layout,
      isDefault: false,
      metadata: params.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    
    await this.saveDashboard(dashboard);
    return dashboard;
  }
  
  async saveDashboard(dashboard: Dashboard): Promise<void> {
    if (!this.db) return;
    
    dashboard.updatedAt = Date.now();
    
    this.db.prepare(`
      INSERT OR REPLACE INTO dashboards 
      (id, name, description, widgets, layout, is_default, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      dashboard.id,
      dashboard.name,
      dashboard.description || null,
      JSON.stringify(dashboard.widgets),
      dashboard.layout ? JSON.stringify(dashboard.layout) : null,
      dashboard.isDefault ? 1 : 0,
      dashboard.metadata ? JSON.stringify(dashboard.metadata) : null,
      dashboard.createdAt,
      dashboard.updatedAt
    );
    
    this.dashboards.set(dashboard.id, dashboard);
    this.emit("dashboard:saved", dashboard);
  }
  
  getDashboard(id: string): Dashboard | null {
    return this.dashboards.get(id) || null;
  }
  
  listDashboards(): Dashboard[] {
    return Array.from(this.dashboards.values());
  }
  
  async deleteDashboard(id: string): Promise<void> {
    if (!this.db) return;
    
    this.db.prepare("DELETE FROM dashboards WHERE id = ?").run(id);
    this.dashboards.delete(id);
    this.emit("dashboard:deleted", { id });
  }
  
  async getDashboardData(dashboardId: string): Promise<Record<string, unknown>> {
    const dashboard = this.dashboards.get(dashboardId);
    if (!dashboard) {
      throw new Error(`Dashboard not found: ${dashboardId}`);
    }
    
    const data: Record<string, unknown> = {};
    
    for (const widget of dashboard.widgets) {
      switch (widget.type) {
        case "metric":
          data[widget.id] = this.getWidgetMetricData(widget);
          break;
        case "chart":
          data[widget.id] = this.getWidgetChartData(widget);
          break;
        case "table":
          data[widget.id] = this.getWidgetTableData(widget);
          break;
      }
    }
    
    return data;
  }
  
  private getWidgetMetricData(widget: DashboardWidget): unknown {
    const timeRange = widget.timeRange ?? { start: Date.now() - 7 * 24 * 60 * 60 * 1000, end: Date.now() };
    
    if (widget.metric === "session_count") {
      if (!this.db) return { value: 0 };
      const row = this.db.prepare(`
        SELECT COUNT(DISTINCT session_id) as count 
        FROM events 
        WHERE timestamp >= ? AND timestamp <= ?
      `).get(timeRange.start, timeRange.end) as { count: number };
      return { value: row?.count || 0 };
    }
    
    if (widget.metric === "event_count") {
      if (!this.db) return { value: 0 };
      const row = this.db.prepare(`
        SELECT COUNT(*) as count 
        FROM events 
        WHERE timestamp >= ? AND timestamp <= ?
      `).get(timeRange.start, timeRange.end) as { count: number };
      return { value: row?.count || 0 };
    }
    
    return { value: 0 };
  }
  
  private getWidgetChartData(widget: DashboardWidget): unknown {
    const groupBy = (widget.groupBy || "day") as "minute" | "hour" | "day" | "week" | "month";
    const timeRange = widget.timeRange ?? { start: Date.now() - 7 * 24 * 60 * 60 * 1000, end: Date.now() };
    
    if (widget.metric === "event_count") {
      return this.aggregateEvents({
        timeRange,
        groupBy,
      });
    }
    
    if (widget.metric === "feature_usage") {
      return this.getUserBehavior();
    }
    
    if (widget.metric === "performance") {
      return this.getPerformanceMetrics({
        timeRange,
      });
    }
    
    return [];
  }
  
  private getWidgetTableData(widget: DashboardWidget): unknown {
    const timeRange = widget.timeRange ?? { start: Date.now() - 7 * 24 * 60 * 60 * 1000, end: Date.now() };
    
    if (widget.metric === "events") {
      return this.queryEvents({
        timeRange,
        limit: 100,
      });
    }
    
    return [];
  }
  
  // ===========================================================================
  // DATA MANAGEMENT
  // ===========================================================================
  
  async exportData(params: {
    timeRange: TimeRange;
    format: "json" | "csv";
  }): Promise<Buffer> {
    const events = this.queryEvents({ timeRange: params.timeRange, limit: 100000 });
    const behavior = this.getUserBehavior();
    const performance = this.getPerformanceMetrics({ timeRange: params.timeRange });
    
    const data = {
      exportedAt: Date.now(),
      timeRange: params.timeRange,
      events,
      behavior,
      performance,
    };
    
    if (params.format === "json") {
      return Buffer.from(JSON.stringify(data, null, 2));
    } else {
      // CSV export (events only)
      const headers = ["id", "sessionId", "userId", "category", "action", "label", "value", "timestamp"];
      const rows = events.map((e) => 
        [e.id, e.sessionId, e.userId, e.category, e.action, e.label || "", e.value || "", e.timestamp].join(",")
      );
      return Buffer.from([headers.join(","), ...rows].join("\n"));
    }
  }
  
  async cleanupOldData(): Promise<{ deletedEvents: number; deletedMetrics: number }> {
    if (!this.db) return { deletedEvents: 0, deletedMetrics: 0 };
    
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    
    const eventsResult = this.db.prepare("DELETE FROM events WHERE timestamp < ?").run(cutoff);
    const metricsResult = this.db.prepare("DELETE FROM metrics WHERE period_end < ?").run(cutoff);
    const perfResult = this.db.prepare("DELETE FROM performance WHERE timestamp < ?").run(cutoff);
    
    logger.info("Cleaned up old analytics data", {
      deletedEvents: eventsResult.changes,
      deletedMetrics: metricsResult.changes,
      deletedPerf: perfResult.changes,
    });
    
    return {
      deletedEvents: eventsResult.changes,
      deletedMetrics: metricsResult.changes + perfResult.changes,
    };
  }
  
  setRetentionDays(days: number): void {
    this.retentionDays = days;
  }
  
  // ===========================================================================
  // STATISTICS
  // ===========================================================================
  
  getStatistics(): {
    totalEvents: number;
    totalSessions: number;
    totalUsers: number;
    topFeatures: Array<{ feature: string; count: number }>;
    recentErrors: Array<{ message: string; count: number }>;
  } {
    if (!this.db) {
      return {
        totalEvents: 0,
        totalSessions: 0,
        totalUsers: 0,
        topFeatures: [],
        recentErrors: [],
      };
    }
    
    const stats = this.db.prepare(`
      SELECT 
        COUNT(*) as total_events,
        COUNT(DISTINCT session_id) as total_sessions,
        COUNT(DISTINCT user_id) as total_users
      FROM events
    `).get() as { total_events: number; total_sessions: number; total_users: number };
    
    const topFeatures = this.db.prepare(`
      SELECT feature, usage_count as count
      FROM user_behavior
      ORDER BY usage_count DESC
      LIMIT 10
    `).all() as Array<{ feature: string; count: number }>;
    
    const recentErrors = this.db.prepare(`
      SELECT label as message, COUNT(*) as count
      FROM events
      WHERE category = 'error' AND timestamp > ?
      GROUP BY label
      ORDER BY count DESC
      LIMIT 10
    `).all(Date.now() - 7 * 24 * 60 * 60 * 1000) as Array<{ message: string; count: number }>;
    
    return {
      totalEvents: stats.total_events,
      totalSessions: stats.total_sessions,
      totalUsers: stats.total_users,
      topFeatures,
      recentErrors,
    };
  }
  
  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================
  
  async shutdown(): Promise<void> {
    // Track session end
    this.trackEvent({
      category: "system",
      action: "session_end",
      value: Date.now() - this.sessionId.length, // Approximate session duration
    });
    
    // Flush remaining events
    this.flushEventBuffer();
    
    // Stop flush interval
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    
    // Close database
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    
    logger.info("Self-hosted analytics shutdown complete");
  }
}

// Export singleton
export const selfHostedAnalytics = new SelfHostedAnalytics();
