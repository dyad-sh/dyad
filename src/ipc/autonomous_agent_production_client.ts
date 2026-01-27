/**
 * Autonomous Agent Production Client API
 * Renderer-side API for production features
 */

import type {
  ScheduleId,
  ApprovalId,
  BackupId,
  TemplateId,
  NotificationId,
  KnowledgeNodeId,
  Schedule,
  ApprovalRequest,
  Backup,
  AgentTemplate,
  Notification,
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgeQuery,
  SystemHealth,
  ResourceUsage,
  ResourceThrottle,
  AuditLogEntry,
  MetricPoint,
  PermissionType,
} from "../lib/autonomous_agent_production";
import type { AutonomousAgentId, MissionId } from "../lib/autonomous_agent";

// =============================================================================
// CLIENT CLASS
// =============================================================================

export class AutonomousAgentProductionClient {
  private static instance: AutonomousAgentProductionClient | null = null;
  private eventCallbacks: Map<string, Set<(data: unknown) => void>> = new Map();
  
  private constructor() {}
  
  static getInstance(): AutonomousAgentProductionClient {
    if (!AutonomousAgentProductionClient.instance) {
      AutonomousAgentProductionClient.instance = new AutonomousAgentProductionClient();
    }
    return AutonomousAgentProductionClient.instance;
  }
  
  // ===========================================================================
  // SYSTEM LIFECYCLE
  // ===========================================================================
  
  async initialize(): Promise<void> {
    await window.electron.ipcRenderer.invoke("autonomous-prod:initialize");
  }
  
  async shutdown(): Promise<void> {
    await window.electron.ipcRenderer.invoke("autonomous-prod:shutdown");
  }
  
  // ===========================================================================
  // RESOURCE MONITORING
  // ===========================================================================
  
  async getResourceUsage(): Promise<ResourceUsage | null> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:get-resources");
  }
  
  async getThrottleState(): Promise<ResourceThrottle> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:get-throttle-state");
  }
  
  // ===========================================================================
  // SECURITY & PERMISSIONS
  // ===========================================================================
  
  async checkPermission(
    agentId: AutonomousAgentId,
    permission: PermissionType,
    resource?: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    return window.electron.ipcRenderer.invoke(
      "autonomous-prod:check-permission",
      agentId,
      permission,
      resource
    );
  }
  
  async getAuditLog(
    agentId?: AutonomousAgentId,
    limit?: number
  ): Promise<AuditLogEntry[]> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:get-audit-log", agentId, limit);
  }
  
  // ===========================================================================
  // SCHEDULING
  // ===========================================================================
  
  async createSchedule(
    schedule: Omit<Schedule, "id" | "createdAt" | "updatedAt" | "runCount" | "failureCount">
  ): Promise<Schedule> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:create-schedule", schedule);
  }
  
  async getSchedules(agentId?: AutonomousAgentId): Promise<Schedule[]> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:get-schedules", agentId);
  }
  
  // ===========================================================================
  // APPROVAL WORKFLOW
  // ===========================================================================
  
  async requestApproval(
    request: Omit<ApprovalRequest, "id" | "status" | "createdAt">
  ): Promise<ApprovalRequest> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:request-approval", request);
  }
  
  async respondToApproval(
    approvalId: ApprovalId,
    approved: boolean,
    approvedBy: string,
    reason?: string,
    modifiedAction?: string
  ): Promise<void> {
    return window.electron.ipcRenderer.invoke(
      "autonomous-prod:respond-approval",
      approvalId,
      approved,
      approvedBy,
      reason,
      modifiedAction
    );
  }
  
  async getPendingApprovals(agentId?: AutonomousAgentId): Promise<ApprovalRequest[]> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:get-pending-approvals", agentId);
  }
  
  // ===========================================================================
  // TEMPLATES
  // ===========================================================================
  
  async getTemplates(category?: string): Promise<AgentTemplate[]> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:get-templates", category);
  }
  
  async getTemplate(id: TemplateId): Promise<AgentTemplate | null> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:get-template", id);
  }
  
  // ===========================================================================
  // NOTIFICATIONS
  // ===========================================================================
  
  async createNotification(
    notification: Omit<Notification, "id" | "delivered" | "read" | "dismissed" | "createdAt">
  ): Promise<Notification> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:create-notification", notification);
  }
  
  async getNotifications(
    agentId?: AutonomousAgentId,
    unreadOnly?: boolean,
    limit?: number
  ): Promise<Notification[]> {
    return window.electron.ipcRenderer.invoke(
      "autonomous-prod:get-notifications",
      agentId,
      unreadOnly,
      limit
    );
  }
  
  async markNotificationRead(id: NotificationId): Promise<void> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:mark-notification-read", id);
  }
  
  // ===========================================================================
  // HEALTH
  // ===========================================================================
  
  async getSystemHealth(): Promise<SystemHealth> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:get-system-health");
  }
  
  // ===========================================================================
  // QUOTAS
  // ===========================================================================
  
  async checkQuota(
    agentId: AutonomousAgentId,
    resource: string,
    amount: number
  ): Promise<{ allowed: boolean; remaining: number; reason?: string }> {
    return window.electron.ipcRenderer.invoke(
      "autonomous-prod:check-quota",
      agentId,
      resource,
      amount
    );
  }
  
  async recordQuotaUsage(
    agentId: AutonomousAgentId,
    resource: string,
    amount: number
  ): Promise<void> {
    return window.electron.ipcRenderer.invoke(
      "autonomous-prod:record-quota-usage",
      agentId,
      resource,
      amount
    );
  }
  
  // ===========================================================================
  // KNOWLEDGE GRAPH
  // ===========================================================================
  
  async addKnowledgeNode(
    node: Omit<KnowledgeNode, "id" | "accessCount" | "usefulnessScore" | "createdAt" | "updatedAt">
  ): Promise<KnowledgeNode> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:add-knowledge-node", node);
  }
  
  async addKnowledgeEdge(
    edge: Omit<KnowledgeEdge, "id" | "createdAt">
  ): Promise<KnowledgeEdge> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:add-knowledge-edge", edge);
  }
  
  async queryKnowledgeGraph(
    query: KnowledgeQuery
  ): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:query-knowledge", query);
  }
  
  // ===========================================================================
  // ANALYTICS
  // ===========================================================================
  
  async recordAnalyticsEvent(event: {
    agentId: AutonomousAgentId;
    event: string;
    category?: string;
    properties?: Record<string, unknown>;
    missionId?: MissionId;
    sessionId?: string;
    duration?: number;
  }): Promise<void> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:record-event", event);
  }
  
  async getMetrics(
    metric: string,
    startTime: number,
    endTime: number,
    aggregation?: "avg" | "sum" | "min" | "max" | "count"
  ): Promise<MetricPoint[]> {
    return window.electron.ipcRenderer.invoke(
      "autonomous-prod:get-metrics",
      metric,
      startTime,
      endTime,
      aggregation
    );
  }
  
  // ===========================================================================
  // BACKUP & RECOVERY
  // ===========================================================================
  
  async createBackup(
    type: Backup["type"],
    agents?: AutonomousAgentId[]
  ): Promise<Backup> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:create-backup", type, agents);
  }
  
  async listBackups(): Promise<Backup[]> {
    return window.electron.ipcRenderer.invoke("autonomous-prod:list-backups");
  }
  
  // ===========================================================================
  // EVENT SUBSCRIPTIONS
  // ===========================================================================
  
  async subscribe(): Promise<void> {
    await window.electron.ipcRenderer.invoke("autonomous-prod:subscribe");
    
    // Use the on method which returns an unsubscribe function via the IPC renderer
    window.electron.ipcRenderer.on(
      "autonomous-prod:event",
      (_event: Electron.IpcRendererEvent, data: { type: string; data: unknown; timestamp: number }) => {
        const callbacks = this.eventCallbacks.get(data.type);
        if (callbacks) {
          for (const callback of callbacks) {
            callback(data.data);
          }
        }
        
        // Also emit to wildcard listeners
        const wildcardCallbacks = this.eventCallbacks.get("*");
        if (wildcardCallbacks) {
          for (const callback of wildcardCallbacks) {
            callback(data);
          }
        }
      }
    );
  }
  
  async unsubscribeFromEvents(): Promise<void> {
    window.electron.ipcRenderer.removeAllListeners("autonomous-prod:event");
    await window.electron.ipcRenderer.invoke("autonomous-prod:unsubscribe");
  }
  
  onEvent(eventType: string, callback: (data: unknown) => void): () => void {
    if (!this.eventCallbacks.has(eventType)) {
      this.eventCallbacks.set(eventType, new Set());
    }
    this.eventCallbacks.get(eventType)!.add(callback);
    
    return () => {
      this.eventCallbacks.get(eventType)?.delete(callback);
    };
  }
}

// Export singleton instance
export const productionClient = AutonomousAgentProductionClient.getInstance();

// Re-export types
export type {
  ScheduleId,
  ApprovalId,
  BackupId,
  TemplateId,
  NotificationId,
  KnowledgeNodeId,
  Schedule,
  ApprovalRequest,
  Backup,
  AgentTemplate,
  Notification,
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgeQuery,
  SystemHealth,
  ResourceUsage,
  ResourceThrottle,
  AuditLogEntry,
  MetricPoint,
  PermissionType,
};
