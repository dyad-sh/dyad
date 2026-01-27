/**
 * React Hooks for Autonomous Agent Production Features
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, useCallback } from "react";
import {
  productionClient,
  type ScheduleId,
  type ApprovalId,
  type BackupId,
  type TemplateId,
  type NotificationId,
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
} from "@/ipc/autonomous_agent_production_client";
import type { AutonomousAgentId, MissionId } from "@/ipc/autonomous_agent_client";

// =============================================================================
// QUERY KEYS
// =============================================================================

export const PRODUCTION_KEYS = {
  all: ["autonomous-production"] as const,
  resources: () => [...PRODUCTION_KEYS.all, "resources"] as const,
  throttle: () => [...PRODUCTION_KEYS.all, "throttle"] as const,
  health: () => [...PRODUCTION_KEYS.all, "health"] as const,
  schedules: (agentId?: AutonomousAgentId) => [...PRODUCTION_KEYS.all, "schedules", agentId] as const,
  approvals: (agentId?: AutonomousAgentId) => [...PRODUCTION_KEYS.all, "approvals", agentId] as const,
  templates: (category?: string) => [...PRODUCTION_KEYS.all, "templates", category] as const,
  template: (id: TemplateId) => [...PRODUCTION_KEYS.all, "template", id] as const,
  notifications: (agentId?: AutonomousAgentId, unreadOnly?: boolean) => 
    [...PRODUCTION_KEYS.all, "notifications", agentId, unreadOnly] as const,
  auditLog: (agentId?: AutonomousAgentId) => [...PRODUCTION_KEYS.all, "auditLog", agentId] as const,
  knowledgeGraph: (query: KnowledgeQuery) => [...PRODUCTION_KEYS.all, "knowledge", query] as const,
  metrics: (metric: string, start: number, end: number) => 
    [...PRODUCTION_KEYS.all, "metrics", metric, start, end] as const,
  backups: () => [...PRODUCTION_KEYS.all, "backups"] as const,
};

// =============================================================================
// RESOURCE MONITORING HOOKS
// =============================================================================

export function useResourceUsage() {
  return useQuery({
    queryKey: PRODUCTION_KEYS.resources(),
    queryFn: () => productionClient.getResourceUsage(),
    refetchInterval: 5000, // Refresh every 5 seconds
  });
}

export function useThrottleState() {
  return useQuery({
    queryKey: PRODUCTION_KEYS.throttle(),
    queryFn: () => productionClient.getThrottleState(),
    refetchInterval: 5000,
  });
}

// =============================================================================
// SYSTEM HEALTH HOOKS
// =============================================================================

export function useSystemHealth() {
  return useQuery({
    queryKey: PRODUCTION_KEYS.health(),
    queryFn: () => productionClient.getSystemHealth(),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

// =============================================================================
// SCHEDULING HOOKS
// =============================================================================

export function useSchedules(agentId?: AutonomousAgentId) {
  return useQuery({
    queryKey: PRODUCTION_KEYS.schedules(agentId),
    queryFn: () => productionClient.getSchedules(agentId),
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (schedule: Omit<Schedule, "id" | "createdAt" | "updatedAt" | "runCount" | "failureCount">) =>
      productionClient.createSchedule(schedule),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTION_KEYS.all });
    },
  });
}

// =============================================================================
// APPROVAL WORKFLOW HOOKS
// =============================================================================

export function usePendingApprovals(agentId?: AutonomousAgentId) {
  return useQuery({
    queryKey: PRODUCTION_KEYS.approvals(agentId),
    queryFn: () => productionClient.getPendingApprovals(agentId),
    refetchInterval: 10000, // Check for new approvals every 10 seconds
  });
}

export function useRequestApproval() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (request: Omit<ApprovalRequest, "id" | "status" | "createdAt">) =>
      productionClient.requestApproval(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTION_KEYS.approvals() });
    },
  });
}

export function useRespondToApproval() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({
      approvalId,
      approved,
      approvedBy,
      reason,
      modifiedAction,
    }: {
      approvalId: ApprovalId;
      approved: boolean;
      approvedBy: string;
      reason?: string;
      modifiedAction?: string;
    }) => productionClient.respondToApproval(approvalId, approved, approvedBy, reason, modifiedAction),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTION_KEYS.approvals() });
    },
  });
}

// =============================================================================
// TEMPLATE HOOKS
// =============================================================================

export function useTemplates(category?: string) {
  return useQuery({
    queryKey: PRODUCTION_KEYS.templates(category),
    queryFn: () => productionClient.getTemplates(category),
  });
}

export function useTemplate(id: TemplateId) {
  return useQuery({
    queryKey: PRODUCTION_KEYS.template(id),
    queryFn: () => productionClient.getTemplate(id),
    enabled: !!id,
  });
}

// =============================================================================
// NOTIFICATION HOOKS
// =============================================================================

export function useNotifications(
  agentId?: AutonomousAgentId,
  unreadOnly = false,
  limit = 50
) {
  return useQuery({
    queryKey: PRODUCTION_KEYS.notifications(agentId, unreadOnly),
    queryFn: () => productionClient.getNotifications(agentId, unreadOnly, limit),
    refetchInterval: 10000,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: NotificationId) => productionClient.markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...PRODUCTION_KEYS.all, "notifications"] });
    },
  });
}

export function useUnreadNotificationCount(agentId?: AutonomousAgentId) {
  const { data: notifications } = useNotifications(agentId, true);
  return notifications?.length ?? 0;
}

// =============================================================================
// AUDIT LOG HOOKS
// =============================================================================

export function useAuditLog(agentId?: AutonomousAgentId, limit = 100) {
  return useQuery({
    queryKey: PRODUCTION_KEYS.auditLog(agentId),
    queryFn: () => productionClient.getAuditLog(agentId, limit),
  });
}

// =============================================================================
// KNOWLEDGE GRAPH HOOKS
// =============================================================================

export function useKnowledgeGraph(query: KnowledgeQuery) {
  return useQuery({
    queryKey: PRODUCTION_KEYS.knowledgeGraph(query),
    queryFn: () => productionClient.queryKnowledgeGraph(query),
  });
}

export function useAddKnowledgeNode() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (node: Omit<KnowledgeNode, "id" | "accessCount" | "usefulnessScore" | "createdAt" | "updatedAt">) =>
      productionClient.addKnowledgeNode(node),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...PRODUCTION_KEYS.all, "knowledge"] });
    },
  });
}

export function useAddKnowledgeEdge() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (edge: Omit<KnowledgeEdge, "id" | "createdAt">) =>
      productionClient.addKnowledgeEdge(edge),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...PRODUCTION_KEYS.all, "knowledge"] });
    },
  });
}

// =============================================================================
// METRICS HOOKS
// =============================================================================

export function useMetrics(
  metric: string,
  startTime: number,
  endTime: number,
  aggregation?: "avg" | "sum" | "min" | "max" | "count"
) {
  return useQuery({
    queryKey: PRODUCTION_KEYS.metrics(metric, startTime, endTime),
    queryFn: () => productionClient.getMetrics(metric, startTime, endTime, aggregation),
  });
}

export function useRecordAnalyticsEvent() {
  return useMutation({
    mutationFn: (event: {
      agentId: AutonomousAgentId;
      event: string;
      category?: string;
      properties?: Record<string, unknown>;
      missionId?: MissionId;
      sessionId?: string;
      duration?: number;
    }) => productionClient.recordAnalyticsEvent(event),
  });
}

// =============================================================================
// BACKUP HOOKS
// =============================================================================

export function useBackups() {
  return useQuery({
    queryKey: PRODUCTION_KEYS.backups(),
    queryFn: () => productionClient.listBackups(),
  });
}

export function useCreateBackup() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({
      type,
      agents,
    }: {
      type: Backup["type"];
      agents?: AutonomousAgentId[];
    }) => productionClient.createBackup(type, agents),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTION_KEYS.backups() });
    },
  });
}

// =============================================================================
// REAL-TIME EVENT HOOKS
// =============================================================================

export function useProductionEvents() {
  const [events, setEvents] = useState<Array<{ type: string; data: unknown; timestamp: number }>>([]);
  const [subscribed, setSubscribed] = useState(false);
  
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    
    const subscribe = async () => {
      await productionClient.subscribe();
      setSubscribed(true);
      
      cleanup = productionClient.onEvent("*", (event) => {
        setEvents((prev) => [event as any, ...prev.slice(0, 99)]);
      });
    };
    
    subscribe();
    
    return () => {
      cleanup?.();
      productionClient.unsubscribeFromEvents();
      setSubscribed(false);
    };
  }, []);
  
  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);
  
  return {
    events,
    subscribed,
    clearEvents,
    latestEvent: events[0],
  };
}

export function useProductionEventListener(
  eventType: string,
  callback: (data: unknown) => void
) {
  useEffect(() => {
    const cleanup = productionClient.onEvent(eventType, callback);
    return cleanup;
  }, [eventType, callback]);
}

// =============================================================================
// COMBINED PRODUCTION MANAGER HOOK
// =============================================================================

export function useProductionManager() {
  const queryClient = useQueryClient();
  
  const resources = useResourceUsage();
  const throttle = useThrottleState();
  const health = useSystemHealth();
  const pendingApprovals = usePendingApprovals();
  const unreadNotifications = useUnreadNotificationCount();
  const { events, latestEvent } = useProductionEvents();
  
  const createSchedule = useCreateSchedule();
  const respondToApproval = useRespondToApproval();
  const markNotificationRead = useMarkNotificationRead();
  const createBackup = useCreateBackup();
  
  const refreshAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: PRODUCTION_KEYS.all });
  }, [queryClient]);
  
  return {
    // Data
    resources: resources.data,
    throttle: throttle.data,
    health: health.data,
    pendingApprovals: pendingApprovals.data ?? [],
    unreadNotifications,
    events,
    latestEvent,
    
    // Loading states
    isLoading: resources.isLoading || throttle.isLoading || health.isLoading,
    
    // Actions
    createSchedule: createSchedule.mutate,
    respondToApproval: respondToApproval.mutate,
    markNotificationRead: markNotificationRead.mutate,
    createBackup: createBackup.mutate,
    refreshAll,
    
    // Mutation states
    isCreatingSchedule: createSchedule.isPending,
    isRespondingToApproval: respondToApproval.isPending,
    isCreatingBackup: createBackup.isPending,
  };
}

// =============================================================================
// INITIALIZATION HOOK
// =============================================================================

export function useInitializeProductionSystem() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: () => productionClient.initialize(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRODUCTION_KEYS.all });
    },
  });
}

export function useShutdownProductionSystem() {
  return useMutation({
    mutationFn: () => productionClient.shutdown(),
  });
}
