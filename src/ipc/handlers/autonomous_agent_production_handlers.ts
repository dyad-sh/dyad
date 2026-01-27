/**
 * Autonomous Agent Production IPC Handlers
 * Handlers for production-ready features
 */

import { ipcMain, BrowserWindow } from "electron";
import {
  getProductionSystem,
  type ScheduleId,
  type ApprovalId,
  type BackupId,
  type TemplateId,
  type NotificationId,
  type KnowledgeNodeId,
  type Schedule,
  type ApprovalRequest,
  type Backup,
  type AgentTemplate,
  type Notification,
  type KnowledgeNode,
  type KnowledgeEdge,
  type KnowledgeQuery,
  type SystemHealth,
  type ResourceUsage,
  type ResourceThrottle,
  type AuditLogEntry,
  type MetricPoint,
  type PermissionType,
} from "../../lib/autonomous_agent_production";
import type { AutonomousAgentId, MissionId, CapabilityType } from "../../lib/autonomous_agent";

// =============================================================================
// HANDLER REGISTRATION
// =============================================================================

export function registerAutonomousAgentProductionHandlers(): void {
  const system = getProductionSystem();
  
  // ---------------------------------------------------------------------------
  // SYSTEM LIFECYCLE
  // ---------------------------------------------------------------------------
  
  ipcMain.handle("autonomous-prod:initialize", async () => {
    await system.initialize();
    return { success: true };
  });
  
  ipcMain.handle("autonomous-prod:shutdown", async () => {
    await system.shutdown();
    return { success: true };
  });
  
  // ---------------------------------------------------------------------------
  // RESOURCE MONITORING
  // ---------------------------------------------------------------------------
  
  ipcMain.handle("autonomous-prod:get-resources", async (): Promise<ResourceUsage | null> => {
    return system.getResourceUsage();
  });
  
  ipcMain.handle("autonomous-prod:get-throttle-state", async (): Promise<ResourceThrottle> => {
    return system.getThrottleState();
  });
  
  // ---------------------------------------------------------------------------
  // SECURITY & PERMISSIONS
  // ---------------------------------------------------------------------------
  
  ipcMain.handle(
    "autonomous-prod:check-permission",
    async (
      _event,
      agentId: AutonomousAgentId,
      permission: PermissionType,
      resource?: string
    ): Promise<{ allowed: boolean; reason?: string }> => {
      return system.checkPermission(agentId, permission, resource);
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:get-audit-log",
    async (
      _event,
      agentId?: AutonomousAgentId,
      limit?: number
    ): Promise<AuditLogEntry[]> => {
      return system.getAuditLog(agentId, limit);
    }
  );
  
  // ---------------------------------------------------------------------------
  // SCHEDULING
  // ---------------------------------------------------------------------------
  
  ipcMain.handle(
    "autonomous-prod:create-schedule",
    async (
      _event,
      schedule: Omit<Schedule, "id" | "createdAt" | "updatedAt" | "runCount" | "failureCount">
    ): Promise<Schedule> => {
      return system.createSchedule(schedule);
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:get-schedules",
    async (_event, agentId?: AutonomousAgentId): Promise<Schedule[]> => {
      return system.getSchedules(agentId);
    }
  );
  
  // ---------------------------------------------------------------------------
  // APPROVAL WORKFLOW
  // ---------------------------------------------------------------------------
  
  ipcMain.handle(
    "autonomous-prod:request-approval",
    async (
      _event,
      request: Omit<ApprovalRequest, "id" | "status" | "createdAt">
    ): Promise<ApprovalRequest> => {
      return system.requestApproval(request);
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:respond-approval",
    async (
      _event,
      approvalId: ApprovalId,
      approved: boolean,
      approvedBy: string,
      reason?: string,
      modifiedAction?: string
    ): Promise<void> => {
      return system.respondToApproval(approvalId, approved, approvedBy, reason, modifiedAction);
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:get-pending-approvals",
    async (_event, agentId?: AutonomousAgentId): Promise<ApprovalRequest[]> => {
      return system.getPendingApprovals(agentId);
    }
  );
  
  // ---------------------------------------------------------------------------
  // TEMPLATES
  // ---------------------------------------------------------------------------
  
  ipcMain.handle(
    "autonomous-prod:get-templates",
    async (_event, category?: string): Promise<AgentTemplate[]> => {
      return system.getTemplates(category);
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:get-template",
    async (_event, id: TemplateId): Promise<AgentTemplate | null> => {
      return system.getTemplate(id);
    }
  );
  
  // ---------------------------------------------------------------------------
  // NOTIFICATIONS
  // ---------------------------------------------------------------------------
  
  ipcMain.handle(
    "autonomous-prod:create-notification",
    async (
      _event,
      notification: Omit<Notification, "id" | "delivered" | "read" | "dismissed" | "createdAt">
    ): Promise<Notification> => {
      return system.createNotification(notification);
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:get-notifications",
    async (
      _event,
      agentId?: AutonomousAgentId,
      unreadOnly?: boolean,
      limit?: number
    ): Promise<Notification[]> => {
      return system.getNotifications(agentId, unreadOnly, limit);
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:mark-notification-read",
    async (_event, id: NotificationId): Promise<void> => {
      return system.markNotificationRead(id);
    }
  );
  
  // ---------------------------------------------------------------------------
  // HEALTH
  // ---------------------------------------------------------------------------
  
  ipcMain.handle(
    "autonomous-prod:get-system-health",
    async (): Promise<SystemHealth> => {
      return system.getSystemHealth();
    }
  );
  
  // ---------------------------------------------------------------------------
  // QUOTAS
  // ---------------------------------------------------------------------------
  
  ipcMain.handle(
    "autonomous-prod:check-quota",
    async (
      _event,
      agentId: AutonomousAgentId,
      resource: string,
      amount: number
    ): Promise<{ allowed: boolean; remaining: number; reason?: string }> => {
      return system.checkQuota(agentId, resource as any, amount);
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:record-quota-usage",
    async (
      _event,
      agentId: AutonomousAgentId,
      resource: string,
      amount: number
    ): Promise<void> => {
      return system.recordQuotaUsage(agentId, resource as any, amount);
    }
  );
  
  // ---------------------------------------------------------------------------
  // KNOWLEDGE GRAPH
  // ---------------------------------------------------------------------------
  
  ipcMain.handle(
    "autonomous-prod:add-knowledge-node",
    async (
      _event,
      node: Omit<KnowledgeNode, "id" | "accessCount" | "usefulnessScore" | "createdAt" | "updatedAt">
    ): Promise<KnowledgeNode> => {
      return system.addKnowledgeNode(node);
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:add-knowledge-edge",
    async (
      _event,
      edge: Omit<KnowledgeEdge, "id" | "createdAt">
    ): Promise<KnowledgeEdge> => {
      return system.addKnowledgeEdge(edge);
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:query-knowledge",
    async (
      _event,
      query: KnowledgeQuery
    ): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> => {
      return system.queryKnowledgeGraph(query);
    }
  );
  
  // ---------------------------------------------------------------------------
  // ANALYTICS
  // ---------------------------------------------------------------------------
  
  ipcMain.handle(
    "autonomous-prod:record-event",
    async (
      _event,
      analyticsEvent: {
        agentId: AutonomousAgentId;
        event: string;
        category?: string;
        properties?: Record<string, unknown>;
        missionId?: MissionId;
        sessionId?: string;
        duration?: number;
      }
    ): Promise<void> => {
      const category: string = analyticsEvent.category ?? "general";
      const properties: Record<string, unknown> = analyticsEvent.properties ?? {};
      return system.recordAnalyticsEvent({
        agentId: analyticsEvent.agentId,
        event: analyticsEvent.event,
        category,
        properties,
        missionId: analyticsEvent.missionId,
        sessionId: analyticsEvent.sessionId,
        duration: analyticsEvent.duration,
      });
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:get-metrics",
    async (
      _event,
      metric: string,
      startTime: number,
      endTime: number,
      aggregation?: "avg" | "sum" | "min" | "max" | "count"
    ): Promise<MetricPoint[]> => {
      return system.getMetrics(metric, startTime, endTime, aggregation);
    }
  );
  
  // ---------------------------------------------------------------------------
  // BACKUP & RECOVERY
  // ---------------------------------------------------------------------------
  
  ipcMain.handle(
    "autonomous-prod:create-backup",
    async (
      _event,
      type: Backup["type"],
      agents?: AutonomousAgentId[]
    ): Promise<Backup> => {
      return system.createBackup(type, agents);
    }
  );
  
  ipcMain.handle(
    "autonomous-prod:list-backups",
    async (): Promise<Backup[]> => {
      return system.listBackups();
    }
  );
  
  // ---------------------------------------------------------------------------
  // EVENT SUBSCRIPTIONS
  // ---------------------------------------------------------------------------
  
  const subscribers = new Set<number>();
  
  ipcMain.handle("autonomous-prod:subscribe", async (event) => {
    const webContentsId = event.sender.id;
    subscribers.add(webContentsId);
    
    return { subscribed: true };
  });
  
  ipcMain.handle("autonomous-prod:unsubscribe", async (event) => {
    const webContentsId = event.sender.id;
    subscribers.delete(webContentsId);
    
    return { unsubscribed: true };
  });
  
  // Forward events to subscribers
  const eventTypes = [
    "initialized",
    "shutdown",
    "resources:updated",
    "throttle:changed",
    "schedule:created",
    "schedule:triggered",
    "schedule:executed",
    "schedule:failed",
    "approval:requested",
    "approval:responded",
    "notification:created",
    "health:checked",
    "knowledge:node_added",
    "knowledge:edge_added",
    "backup:started",
    "backup:completed",
    "backup:failed",
  ];
  
  for (const eventType of eventTypes) {
    system.on(eventType, (data) => {
      for (const webContentsId of subscribers) {
        const window = BrowserWindow.getAllWindows().find(
          (w) => w.webContents.id === webContentsId
        );
        if (window && !window.isDestroyed()) {
          window.webContents.send("autonomous-prod:event", {
            type: eventType,
            data,
            timestamp: Date.now(),
          });
        }
      }
    });
  }
}
