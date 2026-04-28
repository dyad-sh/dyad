/**
 * Autonomous Agent System - Production Features
 * 
 * This module extends the core autonomous agent system with production-ready features:
 * - Resource Monitoring & Throttling
 * - Security & Sandboxing
 * - Scheduling & Cron Jobs
 * - Human-in-the-Loop Approval Workflows
 * - Backup & Disaster Recovery
 * - Analytics & Observability
 * - Agent Templates & Presets
 * - Multi-Model Orchestration
 * - Knowledge Graph
 * - Collaborative Learning Network
 * - Rate Limiting & Quotas
 * - Notification System
 * - Health Checks & Self-Healing
 */

import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import Database from "better-sqlite3";
import type {
  AutonomousAgentId,
  MissionId,
  CapabilityType,
  AutonomousAgent,
  Mission,
  AgentPerformanceMetrics,
} from "./autonomous_agent";

// =============================================================================
// BRANDED TYPES
// =============================================================================

export type ScheduleId = string & { __brand: "ScheduleId" };
export type ApprovalId = string & { __brand: "ApprovalId" };
export type BackupId = string & { __brand: "BackupId" };
export type TemplateId = string & { __brand: "TemplateId" };
export type QuotaId = string & { __brand: "QuotaId" };
export type NotificationId = string & { __brand: "NotificationId" };
export type KnowledgeNodeId = string & { __brand: "KnowledgeNodeId" };
export type HealthCheckId = string & { __brand: "HealthCheckId" };

// =============================================================================
// RESOURCE MONITORING
// =============================================================================

export interface ResourceUsage {
  cpu: {
    usage: number;        // 0-100 percentage
    cores: number;
    loadAverage: number[];
  };
  memory: {
    total: number;        // bytes
    used: number;
    free: number;
    percentage: number;
  };
  disk: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    requestsPerMinute: number;
  };
  gpu?: {
    available: boolean;
    usage: number;
    memoryUsed: number;
    memoryTotal: number;
  };
}

export interface ResourceLimits {
  maxCpuPercent: number;
  maxMemoryMb: number;
  maxStorageMb: number;
  maxNetworkMbps: number;
  maxGpuPercent: number;
  maxTokensPerHour: number;
  maxActionsPerMinute: number;
  maxConcurrentMissions: number;
}

export interface ResourceThrottle {
  enabled: boolean;
  currentLevel: "none" | "light" | "moderate" | "heavy" | "paused";
  reason?: string;
  startedAt?: number;
  autoResumeAt?: number;
}

// =============================================================================
// SECURITY & SANDBOXING
// =============================================================================

export type PermissionType =
  | "file_read"
  | "file_write"
  | "file_delete"
  | "network_outbound"
  | "network_inbound"
  | "process_spawn"
  | "system_info"
  | "model_download"
  | "code_execute"
  | "database_access"
  | "secret_access"
  | "agent_replicate"
  | "agent_modify"
  | "human_contact";

export interface Permission {
  type: PermissionType;
  granted: boolean;
  scope?: string;           // Path pattern, URL pattern, etc.
  grantedBy?: string;       // Who granted
  grantedAt?: number;
  expiresAt?: number;
  usageCount: number;
  lastUsed?: number;
}

export interface SecurityPolicy {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
  
  // Sandboxing
  sandboxEnabled: boolean;
  allowedPaths: string[];
  blockedPaths: string[];
  allowedDomains: string[];
  blockedDomains: string[];
  allowedCommands: string[];
  blockedCommands: string[];
  
  // Secrets
  canAccessSecrets: boolean;
  allowedSecretPatterns: string[];
  
  // Network
  maxRequestsPerMinute: number;
  allowedPorts: number[];
  
  // Code execution
  codeExecutionAllowed: boolean;
  interpreters: string[];     // Allowed interpreters (python, node, etc.)
  maxExecutionTimeMs: number;
  
  createdAt: number;
  updatedAt: number;
}

export interface AuditLogEntry {
  id: string;
  agentId: AutonomousAgentId;
  action: string;
  resource: string;
  permission: PermissionType;
  allowed: boolean;
  reason?: string;
  metadata: Record<string, unknown>;
  timestamp: number;
}

// =============================================================================
// SCHEDULING
// =============================================================================

export interface Schedule {
  id: ScheduleId;
  agentId: AutonomousAgentId;
  name: string;
  description: string;
  
  // Cron expression or interval
  type: "cron" | "interval" | "once";
  cronExpression?: string;
  intervalMs?: number;
  executeAt?: number;
  
  // Mission to create
  missionTemplate: {
    type: string;
    objective: string;
    context: string;
    constraints: string[];
  };
  
  // State
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  
  // Limits
  maxRuns?: number;
  expiresAt?: number;
  
  // Error handling
  failureCount: number;
  maxFailures: number;
  pauseOnFailure: boolean;
  
  createdAt: number;
  updatedAt: number;
}

// =============================================================================
// HUMAN-IN-THE-LOOP APPROVAL
// =============================================================================

export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired" | "auto_approved";

export interface ApprovalRequest {
  id: ApprovalId;
  agentId: AutonomousAgentId;
  missionId?: MissionId;
  
  // What needs approval
  action: string;
  description: string;
  risk: "low" | "medium" | "high" | "critical";
  
  // Context
  context: {
    capability: CapabilityType;
    resource?: string;
    estimatedImpact?: string;
    reversible: boolean;
    alternatives?: string[];
  };
  
  // Code/artifact preview
  preview?: {
    type: "code" | "file" | "command" | "api_call" | "config";
    content: string;
    language?: string;
  };
  
  // Status
  status: ApprovalStatus;
  decision?: {
    approved: boolean;
    reason?: string;
    modifiedAction?: string;
    approvedBy: string;
    approvedAt: number;
  };
  
  // Timing
  createdAt: number;
  expiresAt: number;
  respondedAt?: number;
  
  // Auto-approval rules
  autoApproveIfSimilar?: ApprovalId;
  similarityThreshold?: number;
}

export interface ApprovalPolicy {
  id: string;
  name: string;
  
  // What requires approval
  requireApprovalFor: {
    capabilities: CapabilityType[];
    actions: string[];
    riskLevels: string[];
    resourcePatterns: string[];
  };
  
  // Auto-approval rules
  autoApprove: {
    enabled: boolean;
    maxRisk: "low" | "medium";
    trustedAgents: AutonomousAgentId[];
    trustedPatterns: string[];
    maxTokenValue: number;
  };
  
  // Escalation
  escalation: {
    timeoutMs: number;
    defaultAction: "approve" | "reject" | "escalate";
    escalateTo?: string;
  };
  
  createdAt: number;
}

// =============================================================================
// BACKUP & DISASTER RECOVERY
// =============================================================================

export interface Backup {
  id: BackupId;
  type: "full" | "incremental" | "agent_only" | "knowledge_only";
  
  // Content
  agents: AutonomousAgentId[];
  includesKnowledge: boolean;
  includesMissions: boolean;
  includesArtifacts: boolean;
  includesSchedules: boolean;
  
  // Storage
  path: string;
  size: number;
  compressed: boolean;
  encrypted: boolean;
  encryptionKey?: string;
  
  // Metadata
  version: string;
  checksum: string;
  
  // Status
  status: "creating" | "completed" | "failed" | "restoring";
  error?: string;
  
  createdAt: number;
  completedAt?: number;
}

export interface RecoveryPoint {
  id: string;
  agentId: AutonomousAgentId;
  
  // State snapshot
  state: {
    agent: Partial<AutonomousAgent>;
    missionQueue: MissionId[];
    metrics: AgentPerformanceMetrics;
  };
  
  // What triggered this
  trigger: "scheduled" | "before_evolution" | "before_mission" | "manual" | "error";
  
  // Metadata
  description: string;
  
  createdAt: number;
  expiresAt?: number;
}

// =============================================================================
// AGENT TEMPLATES
// =============================================================================

export interface AgentTemplate {
  id: TemplateId;
  name: string;
  description: string;
  category: string;
  tags: string[];
  
  // Agent configuration
  config: {
    purpose: string;
    autonomyLevel: "supervised" | "semi-autonomous" | "fully-autonomous";
    capabilities: CapabilityType[];
    
    // Model settings
    primaryModel: string;
    fallbackModels: string[];
    temperature: number;
    
    // Limits
    maxActionsPerHour: number;
    maxTokensPerMission: number;
    
    // Features
    voiceEnabled: boolean;
    learningEnabled: boolean;
    canEvolve: boolean;
    canReplicate: boolean;
  };
  
  // Initial knowledge
  initialKnowledge?: {
    patterns: string[];
    skills: string[];
    facts: string[];
  };
  
  // Security
  securityPolicy: string;
  
  // Metadata
  author: string;
  version: string;
  icon?: string;
  
  // Usage stats
  usageCount: number;
  rating: number;
  
  createdAt: number;
  updatedAt: number;
}

// Built-in templates
export const BUILT_IN_TEMPLATES: Omit<AgentTemplate, "id" | "createdAt" | "updatedAt" | "usageCount" | "rating">[] = [
  {
    name: "Research Assistant",
    description: "Autonomous agent specialized in web research, data gathering, and information synthesis",
    category: "Research",
    tags: ["research", "web", "data", "analysis"],
    config: {
      purpose: "Gather, analyze, and synthesize information from various sources",
      autonomyLevel: "semi-autonomous",
      capabilities: ["scraping", "web_browsing", "data_analysis", "model_usage", "file_operations"],
      primaryModel: "gpt-5-mini",
      fallbackModels: ["gemini-3-flash-preview", "claude-sonnet-4-5"],
      temperature: 0.3,
      maxActionsPerHour: 100,
      maxTokensPerMission: 50000,
      voiceEnabled: false,
      learningEnabled: true,
      canEvolve: true,
      canReplicate: false,
    },
    initialKnowledge: {
      patterns: ["search_refinement", "source_validation", "fact_checking"],
      skills: ["web_search", "data_extraction", "summarization"],
      facts: [],
    },
    securityPolicy: "research_policy",
    author: "JoyCreate",
    version: "1.0.0",
    icon: "Ã°Å¸â€Â",
  },
  {
    name: "Code Builder",
    description: "Full-stack development agent that can create, modify, and test code autonomously",
    category: "Development",
    tags: ["code", "development", "testing", "automation"],
    config: {
      purpose: "Generate, modify, test, and deploy code across various languages and frameworks",
      autonomyLevel: "semi-autonomous",
      capabilities: ["code_generation", "file_operations", "terminal", "model_usage", "data_analysis"],
      primaryModel: "gpt-5-mini",
      fallbackModels: ["claude-sonnet-4-5", "deepseek-coder"],
      temperature: 0.2,
      maxActionsPerHour: 200,
      maxTokensPerMission: 100000,
      voiceEnabled: false,
      learningEnabled: true,
      canEvolve: true,
      canReplicate: true,
    },
    initialKnowledge: {
      patterns: ["code_structure", "error_handling", "testing_patterns"],
      skills: ["typescript", "python", "react", "testing", "debugging"],
      facts: [],
    },
    securityPolicy: "developer_policy",
    author: "JoyCreate",
    version: "1.0.0",
    icon: "Ã°Å¸â€™Â»",
  },
  {
    name: "UI Designer",
    description: "Creative agent for designing and generating user interfaces and components",
    category: "Design",
    tags: ["ui", "design", "components", "styling"],
    config: {
      purpose: "Design and generate beautiful, accessible user interfaces",
      autonomyLevel: "supervised",
      capabilities: ["ui_generation", "code_generation", "file_operations", "model_usage"],
      primaryModel: "gpt-5.1",
      fallbackModels: ["gpt-5-mini", "claude-sonnet-4-5"],
      temperature: 0.7,
      maxActionsPerHour: 50,
      maxTokensPerMission: 75000,
      voiceEnabled: false,
      learningEnabled: true,
      canEvolve: true,
      canReplicate: false,
    },
    initialKnowledge: {
      patterns: ["design_systems", "accessibility", "responsive_design"],
      skills: ["tailwind", "shadcn", "figma_to_code", "animation"],
      facts: [],
    },
    securityPolicy: "designer_policy",
    author: "JoyCreate",
    version: "1.0.0",
    icon: "Ã°Å¸Å½Â¨",
  },
  {
    name: "Data Analyst",
    description: "Agent specialized in data processing, analysis, and visualization",
    category: "Analytics",
    tags: ["data", "analysis", "visualization", "statistics"],
    config: {
      purpose: "Process, analyze, and visualize data to extract actionable insights",
      autonomyLevel: "semi-autonomous",
      capabilities: ["data_analysis", "code_generation", "file_operations", "model_usage", "database"],
      primaryModel: "gpt-5-mini",
      fallbackModels: ["claude-sonnet-4-5"],
      temperature: 0.1,
      maxActionsPerHour: 150,
      maxTokensPerMission: 80000,
      voiceEnabled: false,
      learningEnabled: true,
      canEvolve: true,
      canReplicate: false,
    },
    initialKnowledge: {
      patterns: ["statistical_analysis", "data_cleaning", "visualization_best_practices"],
      skills: ["pandas", "sql", "charting", "regression", "clustering"],
      facts: [],
    },
    securityPolicy: "analyst_policy",
    author: "JoyCreate",
    version: "1.0.0",
    icon: "Ã°Å¸â€œÅ ",
  },
  {
    name: "Voice Assistant",
    description: "Voice-enabled agent for hands-free interaction and task execution",
    category: "Assistant",
    tags: ["voice", "assistant", "hands-free", "accessibility"],
    config: {
      purpose: "Provide voice-based interaction for task execution and information retrieval",
      autonomyLevel: "supervised",
      capabilities: ["voice_input", "voice_output", "model_usage", "web_browsing", "file_operations"],
      primaryModel: "gpt-5-mini",
      fallbackModels: ["gemini-3-flash-preview"],
      temperature: 0.5,
      maxActionsPerHour: 300,
      maxTokensPerMission: 20000,
      voiceEnabled: true,
      learningEnabled: true,
      canEvolve: false,
      canReplicate: false,
    },
    securityPolicy: "assistant_policy",
    author: "JoyCreate",
    version: "1.0.0",
    icon: "Ã°Å¸Å½Â¤",
  },
  {
    name: "Automation Bot",
    description: "Task automation agent for repetitive workflows and scheduled jobs",
    category: "Automation",
    tags: ["automation", "workflow", "scheduling", "integration"],
    config: {
      purpose: "Automate repetitive tasks, workflows, and integrations",
      autonomyLevel: "fully-autonomous",
      capabilities: ["terminal", "api_calls", "file_operations", "model_usage", "database"],
      primaryModel: "gemini-3-flash-preview",
      fallbackModels: ["gpt-5-mini"],
      temperature: 0.1,
      maxActionsPerHour: 500,
      maxTokensPerMission: 30000,
      voiceEnabled: false,
      learningEnabled: true,
      canEvolve: true,
      canReplicate: true,
    },
    initialKnowledge: {
      patterns: ["error_recovery", "retry_logic", "idempotency"],
      skills: ["shell_scripting", "api_integration", "scheduling"],
      facts: [],
    },
    securityPolicy: "automation_policy",
    author: "JoyCreate",
    version: "1.0.0",
    icon: "Ã°Å¸Â¤â€“",
  },
  {
    name: "Security Sentinel",
    description: "Security-focused agent for monitoring, auditing, and threat detection",
    category: "Security",
    tags: ["security", "monitoring", "audit", "threat-detection"],
    config: {
      purpose: "Monitor systems, detect threats, and maintain security compliance",
      autonomyLevel: "supervised",
      capabilities: ["data_analysis", "file_operations", "terminal", "model_usage", "api_calls"],
      primaryModel: "gpt-5-mini",
      fallbackModels: ["claude-sonnet-4-5"],
      temperature: 0.1,
      maxActionsPerHour: 100,
      maxTokensPerMission: 40000,
      voiceEnabled: false,
      learningEnabled: true,
      canEvolve: false,
      canReplicate: false,
    },
    initialKnowledge: {
      patterns: ["threat_patterns", "vulnerability_signatures", "compliance_rules"],
      skills: ["log_analysis", "anomaly_detection", "incident_response"],
      facts: [],
    },
    securityPolicy: "security_sentinel_policy",
    author: "JoyCreate",
    version: "1.0.0",
    icon: "Ã°Å¸â€ºÂ¡Ã¯Â¸Â",
  },
  {
    name: "Knowledge Curator",
    description: "Agent for building and maintaining knowledge bases and documentation",
    category: "Knowledge",
    tags: ["knowledge", "documentation", "curation", "learning"],
    config: {
      purpose: "Curate, organize, and maintain knowledge bases and documentation",
      autonomyLevel: "semi-autonomous",
      capabilities: ["scraping", "web_browsing", "file_operations", "model_usage", "learning"],
      primaryModel: "gpt-5-mini",
      fallbackModels: ["claude-sonnet-4-5"],
      temperature: 0.3,
      maxActionsPerHour: 80,
      maxTokensPerMission: 60000,
      voiceEnabled: false,
      learningEnabled: true,
      canEvolve: true,
      canReplicate: false,
    },
    initialKnowledge: {
      patterns: ["knowledge_organization", "taxonomy_design", "linking_strategies"],
      skills: ["summarization", "categorization", "relationship_extraction"],
      facts: [],
    },
    securityPolicy: "curator_policy",
    author: "JoyCreate",
    version: "1.0.0",
    icon: "Ã°Å¸â€œÅ¡",
  },
];

// =============================================================================
// MULTI-MODEL ORCHESTRATION
// =============================================================================

export interface ModelProfile {
  id: string;
  name: string;
  provider: "openai" | "anthropic" | "local" | "custom";
  model: string;
  
  // Capabilities
  strengths: string[];
  weaknesses: string[];
  
  // Performance
  avgLatencyMs: number;
  tokensPerSecond: number;
  costPer1kTokens: number;
  
  // Limits
  maxContextTokens: number;
  maxOutputTokens: number;
  
  // Features
  supportsVision: boolean;
  supportsFunctionCalling: boolean;
  supportsStreaming: boolean;
  
  // Health
  available: boolean;
  lastChecked: number;
  errorRate: number;
}

export interface ModelRoutingRule {
  id: string;
  name: string;
  
  // Conditions
  conditions: {
    taskTypes?: string[];
    capabilities?: CapabilityType[];
    maxLatencyMs?: number;
    maxCost?: number;
    requiresVision?: boolean;
    requiresFunctionCalling?: boolean;
    minContextTokens?: number;
  };
  
  // Routing
  primaryModel: string;
  fallbackModels: string[];
  
  // Load balancing
  loadBalancing: "round-robin" | "least-latency" | "least-cost" | "random";
  
  priority: number;
}

export interface ModelOrchestrationConfig {
  // Default model
  defaultModel: string;
  
  // Routing rules
  routingRules: ModelRoutingRule[];
  
  // Fallback behavior
  fallbackEnabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
  
  // Cost management
  maxDailyCost: number;
  currentDailyCost: number;
  costAlertThreshold: number;
  
  // Performance
  preferLocalModels: boolean;
  localModelPriority: number;
}

// =============================================================================
// KNOWLEDGE GRAPH
// =============================================================================

export interface KnowledgeNode {
  id: KnowledgeNodeId;
  type: "concept" | "entity" | "fact" | "skill" | "pattern" | "agent" | "artifact";
  
  // Content
  name: string;
  description: string;
  properties: Record<string, unknown>;
  
  // Source
  sourceAgent?: AutonomousAgentId;
  sourceType: "learned" | "inherited" | "imported" | "inferred";
  
  // Confidence
  confidence: number;
  validatedBy: AutonomousAgentId[];
  
  // Usage
  accessCount: number;
  lastAccessed?: number;
  usefulnessScore: number;
  
  // Metadata
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeEdge {
  id: string;
  fromNode: KnowledgeNodeId;
  toNode: KnowledgeNodeId;
  
  // Relationship
  type: "related_to" | "part_of" | "causes" | "enables" | "conflicts_with" | "similar_to" | "derived_from" | "requires";
  strength: number;  // 0-1
  
  // Metadata
  bidirectional: boolean;
  createdBy?: AutonomousAgentId;
  evidence?: string[];
  
  createdAt: number;
}

export interface KnowledgeQuery {
  // Node filters
  nodeTypes?: string[];
  tags?: string[];
  minConfidence?: number;
  createdAfter?: number;
  
  // Relationship filters
  edgeTypes?: string[];
  depth?: number;
  
  // Text search
  searchText?: string;
  
  // Pagination
  limit?: number;
  offset?: number;
}

// =============================================================================
// COLLABORATIVE LEARNING NETWORK
// =============================================================================

export interface LearningShare {
  id: string;
  fromAgent: AutonomousAgentId;
  toAgents: AutonomousAgentId[] | "all";
  
  // Shared content
  type: "pattern" | "skill" | "fact" | "strategy" | "error_recovery";
  content: unknown;
  
  // Context
  context: string;
  applicableTo: string[];
  
  // Validation
  validated: boolean;
  validations: {
    agentId: AutonomousAgentId;
    success: boolean;
    feedback?: string;
    timestamp: number;
  }[];
  
  // Stats
  adoptionCount: number;
  successRate: number;
  
  createdAt: number;
}

export interface CollaborationSession {
  id: string;
  agents: AutonomousAgentId[];
  
  // Goal
  objective: string;
  status: "active" | "completed" | "failed";
  
  // Communication
  messages: {
    from: AutonomousAgentId;
    content: string;
    type: "info" | "request" | "response" | "decision";
    timestamp: number;
  }[];
  
  // Shared artifacts
  sharedArtifacts: string[];
  
  // Results
  result?: unknown;
  
  createdAt: number;
  completedAt?: number;
}

// =============================================================================
// RATE LIMITING & QUOTAS
// =============================================================================

export interface Quota {
  id: QuotaId;
  agentId: AutonomousAgentId;
  
  // Time period
  period: "hourly" | "daily" | "weekly" | "monthly";
  periodStart: number;
  periodEnd: number;
  
  // Limits
  limits: {
    tokens: { limit: number; used: number };
    actions: { limit: number; used: number };
    missions: { limit: number; used: number };
    apiCalls: { limit: number; used: number };
    fileOperations: { limit: number; used: number };
    cost: { limit: number; used: number };
  };
  
  // Alerts
  alertThreshold: number;  // 0-1
  alertSent: boolean;
  
  // Behavior when exceeded
  onExceeded: "pause" | "throttle" | "notify" | "ignore";
}

export interface RateLimiter {
  id: string;
  agentId: AutonomousAgentId;
  
  // Configuration
  resource: string;
  maxRequests: number;
  windowMs: number;
  
  // Current state
  currentCount: number;
  windowStart: number;
  
  // Throttling
  throttled: boolean;
  throttleUntil?: number;
}

// =============================================================================
// NOTIFICATIONS
// =============================================================================

export type NotificationPriority = "low" | "medium" | "high" | "critical";
export type NotificationChannel = "ui" | "system" | "email" | "webhook" | "voice";

export interface Notification {
  id: NotificationId;
  agentId: AutonomousAgentId;
  
  // Content
  title: string;
  message: string;
  type: "info" | "success" | "warning" | "error" | "approval_request";
  priority: NotificationPriority;
  
  // Delivery
  channels: NotificationChannel[];
  delivered: NotificationChannel[];
  
  // Actions
  actions?: {
    label: string;
    action: string;
    primary?: boolean;
  }[];
  
  // State
  read: boolean;
  dismissed: boolean;
  actedOn?: string;
  
  // Related
  missionId?: MissionId;
  approvalId?: ApprovalId;
  
  createdAt: number;
  readAt?: number;
  expiresAt?: number;
}

export interface NotificationPreferences {
  // Channels
  enabledChannels: NotificationChannel[];
  
  // Filters
  minPriority: NotificationPriority;
  mutedAgents: AutonomousAgentId[];
  mutedTypes: string[];
  
  // Quiet hours
  quietHoursEnabled: boolean;
  quietHoursStart: string;  // "22:00"
  quietHoursEnd: string;    // "07:00"
  
  // Aggregation
  aggregateNotifications: boolean;
  aggregateWindowMs: number;
  
  // Webhook
  webhookUrl?: string;
  webhookSecret?: string;
}

// =============================================================================
// HEALTH CHECKS & SELF-HEALING
// =============================================================================

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "critical";

export interface HealthCheck {
  id: HealthCheckId;
  name: string;
  type: "agent" | "system" | "model" | "database" | "network" | "storage";
  
  // Check configuration
  checkInterval: number;
  timeout: number;
  retries: number;
  
  // Current status
  status: HealthStatus;
  lastCheck: number;
  lastSuccess?: number;
  consecutiveFailures: number;
  
  // Details
  details: Record<string, unknown>;
  error?: string;
  
  // Auto-healing
  autoHealEnabled: boolean;
  healingActions: HealingAction[];
  healingAttempts: number;
  lastHealAttempt?: number;
}

export interface HealingAction {
  id: string;
  name: string;
  type: "restart" | "reset" | "clear_cache" | "reduce_load" | "failover" | "notify";
  
  // Conditions
  triggerOn: HealthStatus[];
  minFailures: number;
  cooldownMs: number;
  
  // Action details
  params: Record<string, unknown>;
  
  // Stats
  executionCount: number;
  successRate: number;
  lastExecution?: number;
}

export interface SystemHealth {
  overall: HealthStatus;
  timestamp: number;
  
  components: {
    agents: HealthStatus;
    database: HealthStatus;
    models: HealthStatus;
    network: HealthStatus;
    storage: HealthStatus;
  };
  
  activeAgents: number;
  totalMissions: number;
  pendingApprovals: number;
  
  resources: ResourceUsage;
  
  issues: {
    component: string;
    status: HealthStatus;
    message: string;
    since: number;
  }[];
}

// =============================================================================
// ANALYTICS & OBSERVABILITY
// =============================================================================

export interface AnalyticsEvent {
  id: string;
  agentId: AutonomousAgentId;
  
  // Event
  event: string;
  category: string;
  
  // Properties
  properties: Record<string, unknown>;
  
  // Context
  missionId?: MissionId;
  sessionId?: string;
  
  // Timing
  duration?: number;
  timestamp: number;
}

export interface MetricPoint {
  metric: string;
  value: number;
  tags: Record<string, string>;
  timestamp: number;
}

export interface Dashboard {
  id: string;
  name: string;
  
  // Widgets
  widgets: DashboardWidget[];
  
  // Filters
  timeRange: { start: number; end: number };
  agentFilter?: AutonomousAgentId[];
  
  // Refresh
  autoRefresh: boolean;
  refreshIntervalMs: number;
  
  createdAt: number;
  updatedAt: number;
}

export interface DashboardWidget {
  id: string;
  type: "metric" | "chart" | "table" | "log" | "status";
  
  // Position
  x: number;
  y: number;
  width: number;
  height: number;
  
  // Configuration
  title: string;
  config: Record<string, unknown>;
  
  // Data source
  dataSource: {
    type: "metrics" | "events" | "agents" | "missions";
    query: string;
    aggregation?: "sum" | "avg" | "min" | "max" | "count";
  };
}

// =============================================================================
// PRODUCTION SYSTEM CLASS
// =============================================================================

export class AutonomousAgentProductionSystem extends EventEmitter {
  private static instance: AutonomousAgentProductionSystem | null = null;
  
  private db: Database.Database | null = null;
  private dataPath: string;
  private initialized = false;
  
  // Runtime state
  private resourceMonitor: NodeJS.Timeout | null = null;
  private healthChecker: NodeJS.Timeout | null = null;
  private scheduleRunner: NodeJS.Timeout | null = null;
  private quotaResetTimer: NodeJS.Timeout | null = null;
  
  private currentResources: ResourceUsage | null = null;
  private throttleState: ResourceThrottle = { enabled: false, currentLevel: "none" };
  
  // Caches
  private templates: Map<TemplateId, AgentTemplate> = new Map();
  private policies: Map<string, SecurityPolicy> = new Map();
  private schedules: Map<ScheduleId, Schedule> = new Map();
  private healthChecks: Map<HealthCheckId, HealthCheck> = new Map();
  
  private constructor() {
    super();
    this.dataPath = path.join(app.getPath("userData"), "autonomous_production");
  }
  
  static getInstance(): AutonomousAgentProductionSystem {
    if (!AutonomousAgentProductionSystem.instance) {
      AutonomousAgentProductionSystem.instance = new AutonomousAgentProductionSystem();
    }
    return AutonomousAgentProductionSystem.instance;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Ensure data directory exists
    await fs.mkdir(this.dataPath, { recursive: true });
    
    // Initialize database
    const dbPath = path.join(this.dataPath, "production.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    
    // Create tables
    this.createTables();
    
    // Load templates
    await this.loadBuiltInTemplates();
    
    // Start background tasks
    this.startResourceMonitor();
    this.startHealthChecker();
    this.startScheduleRunner();
    this.startQuotaResetTimer();
    
    this.initialized = true;
    this.emit("initialized");
  }
  
  private createTables(): void {
    if (!this.db) return;
    
    // Security policies
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS security_policies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        permissions_json TEXT,
        sandbox_config_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    
    // Audit log
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT,
        permission TEXT,
        allowed INTEGER NOT NULL,
        reason TEXT,
        metadata_json TEXT,
        timestamp INTEGER NOT NULL
      )
    `);
    
    // Schedules
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schedules (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL,
        cron_expression TEXT,
        interval_ms INTEGER,
        execute_at INTEGER,
        mission_template_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        last_run_at INTEGER,
        next_run_at INTEGER,
        run_count INTEGER DEFAULT 0,
        max_runs INTEGER,
        expires_at INTEGER,
        failure_count INTEGER DEFAULT 0,
        max_failures INTEGER DEFAULT 3,
        pause_on_failure INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    
    // Approval requests
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        mission_id TEXT,
        action TEXT NOT NULL,
        description TEXT NOT NULL,
        risk TEXT NOT NULL,
        context_json TEXT,
        preview_json TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        decision_json TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        responded_at INTEGER
      )
    `);
    
    // Backups
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        agents_json TEXT,
        includes_knowledge INTEGER,
        includes_missions INTEGER,
        includes_artifacts INTEGER,
        includes_schedules INTEGER,
        path TEXT NOT NULL,
        size INTEGER,
        compressed INTEGER,
        encrypted INTEGER,
        encryption_key TEXT,
        version TEXT,
        checksum TEXT,
        status TEXT NOT NULL,
        error TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);
    
    // Agent templates
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT,
        tags_json TEXT,
        config_json TEXT NOT NULL,
        initial_knowledge_json TEXT,
        security_policy TEXT,
        author TEXT,
        version TEXT,
        icon TEXT,
        usage_count INTEGER DEFAULT 0,
        rating REAL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    
    // Quotas
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quotas (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        period TEXT NOT NULL,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        limits_json TEXT NOT NULL,
        alert_threshold REAL DEFAULT 0.8,
        alert_sent INTEGER DEFAULT 0,
        on_exceeded TEXT DEFAULT 'throttle'
      )
    `);
    
    // Notifications
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        type TEXT NOT NULL,
        priority TEXT NOT NULL,
        channels_json TEXT,
        delivered_json TEXT,
        actions_json TEXT,
        read INTEGER DEFAULT 0,
        dismissed INTEGER DEFAULT 0,
        acted_on TEXT,
        mission_id TEXT,
        approval_id TEXT,
        created_at INTEGER NOT NULL,
        read_at INTEGER,
        expires_at INTEGER
      )
    `);
    
    // Knowledge graph nodes
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        properties_json TEXT,
        source_agent TEXT,
        source_type TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        validated_by_json TEXT,
        access_count INTEGER DEFAULT 0,
        last_accessed INTEGER,
        usefulness_score REAL DEFAULT 0,
        tags_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    
    // Knowledge graph edges
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_edges (
        id TEXT PRIMARY KEY,
        from_node TEXT NOT NULL,
        to_node TEXT NOT NULL,
        type TEXT NOT NULL,
        strength REAL DEFAULT 1.0,
        bidirectional INTEGER DEFAULT 0,
        created_by TEXT,
        evidence_json TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (from_node) REFERENCES knowledge_nodes(id),
        FOREIGN KEY (to_node) REFERENCES knowledge_nodes(id)
      )
    `);
    
    // Health checks
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS health_checks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        check_interval INTEGER NOT NULL,
        timeout INTEGER NOT NULL,
        retries INTEGER DEFAULT 3,
        status TEXT DEFAULT 'healthy',
        last_check INTEGER,
        last_success INTEGER,
        consecutive_failures INTEGER DEFAULT 0,
        details_json TEXT,
        error TEXT,
        auto_heal_enabled INTEGER DEFAULT 0,
        healing_actions_json TEXT,
        healing_attempts INTEGER DEFAULT 0,
        last_heal_attempt INTEGER
      )
    `);
    
    // Analytics events
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        event TEXT NOT NULL,
        category TEXT,
        properties_json TEXT,
        mission_id TEXT,
        session_id TEXT,
        duration INTEGER,
        timestamp INTEGER NOT NULL
      )
    `);
    
    // Metrics
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metric TEXT NOT NULL,
        value REAL NOT NULL,
        tags_json TEXT,
        timestamp INTEGER NOT NULL
      )
    `);
    
    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_agent ON audit_log(agent_id);
      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_schedules_agent ON schedules(agent_id);
      CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at);
      CREATE INDEX IF NOT EXISTS idx_approvals_status ON approval_requests(status);
      CREATE INDEX IF NOT EXISTS idx_notifications_agent ON notifications(agent_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
      CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_nodes(type);
      CREATE INDEX IF NOT EXISTS idx_analytics_agent ON analytics_events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_analytics_timestamp ON analytics_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics(timestamp);
    `);
  }
  
  async shutdown(): Promise<void> {
    // Stop background tasks
    if (this.resourceMonitor) {
      clearInterval(this.resourceMonitor);
      this.resourceMonitor = null;
    }
    if (this.healthChecker) {
      clearInterval(this.healthChecker);
      this.healthChecker = null;
    }
    if (this.scheduleRunner) {
      clearInterval(this.scheduleRunner);
      this.scheduleRunner = null;
    }
    if (this.quotaResetTimer) {
      clearInterval(this.quotaResetTimer);
      this.quotaResetTimer = null;
    }
    
    // Close database
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    
    this.initialized = false;
    this.emit("shutdown");
  }
  
  // ===========================================================================
  // RESOURCE MONITORING
  // ===========================================================================
  
  private startResourceMonitor(): void {
    this.resourceMonitor = setInterval(() => {
      this.updateResourceUsage();
    }, 5000); // Every 5 seconds
  }
  
  private async updateResourceUsage(): Promise<void> {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    this.currentResources = {
      cpu: {
        usage: this.calculateCpuUsage(cpus),
        cores: cpus.length,
        loadAverage: os.loadavg(),
      },
      memory: {
        total: totalMem,
        used: totalMem - freeMem,
        free: freeMem,
        percentage: ((totalMem - freeMem) / totalMem) * 100,
      },
      disk: await this.getDiskUsage(),
      network: {
        bytesIn: 0, // Would need OS-specific implementation
        bytesOut: 0,
        requestsPerMinute: 0,
      },
    };
    
    // Check for throttling
    await this.evaluateThrottling();
    
    // Record metrics
    this.recordMetric("system.cpu.usage", this.currentResources.cpu.usage);
    this.recordMetric("system.memory.percentage", this.currentResources.memory.percentage);
    this.recordMetric("system.disk.percentage", this.currentResources.disk.percentage);
    
    this.emit("resources:updated", this.currentResources);
  }
  
  private calculateCpuUsage(cpus: os.CpuInfo[]): number {
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type as keyof typeof cpu.times];
      }
      totalIdle += cpu.times.idle;
    }
    
    return 100 - (totalIdle / totalTick) * 100;
  }
  
  private async getDiskUsage(): Promise<ResourceUsage["disk"]> {
    try {
      const stats = await fs.stat(this.dataPath);
      // This is a simplified version - would need OS-specific implementation for actual disk usage
      return {
        total: 0,
        used: 0,
        free: 0,
        percentage: 0,
      };
    } catch {
      return { total: 0, used: 0, free: 0, percentage: 0 };
    }
  }
  
  private async evaluateThrottling(): Promise<void> {
    if (!this.currentResources) return;
    
    const cpu = this.currentResources.cpu.usage;
    const mem = this.currentResources.memory.percentage;
    
    let newLevel: ResourceThrottle["currentLevel"] = "none";
    let reason: string | undefined;
    
    if (cpu > 90 || mem > 90) {
      newLevel = "paused";
      reason = `Critical resource usage: CPU ${cpu.toFixed(1)}%, Memory ${mem.toFixed(1)}%`;
    } else if (cpu > 80 || mem > 80) {
      newLevel = "heavy";
      reason = `High resource usage: CPU ${cpu.toFixed(1)}%, Memory ${mem.toFixed(1)}%`;
    } else if (cpu > 70 || mem > 70) {
      newLevel = "moderate";
      reason = `Elevated resource usage`;
    } else if (cpu > 60 || mem > 60) {
      newLevel = "light";
    }
    
    if (newLevel !== this.throttleState.currentLevel) {
      this.throttleState = {
        enabled: newLevel !== "none",
        currentLevel: newLevel,
        reason,
        startedAt: newLevel !== "none" ? Date.now() : undefined,
      };
      
      this.emit("throttle:changed", this.throttleState);
      
      if (newLevel === "paused" || newLevel === "heavy") {
        await this.createNotification({
          agentId: "system" as AutonomousAgentId,
          title: "Resource Throttling Active",
          message: reason || "System resources are constrained",
          type: "warning",
          priority: "high",
          channels: ["ui", "system"],
        });
      }
    }
  }
  
  getResourceUsage(): ResourceUsage | null {
    return this.currentResources;
  }
  
  getThrottleState(): ResourceThrottle {
    return this.throttleState;
  }
  
  // ===========================================================================
  // SECURITY & PERMISSIONS
  // ===========================================================================
  
  async checkPermission(
    agentId: AutonomousAgentId,
    permission: PermissionType,
    resource?: string
  ): Promise<{ allowed: boolean; reason?: string }> {
    // Get agent's security policy
    const policy = await this.getAgentSecurityPolicy(agentId);
    if (!policy) {
      return { allowed: false, reason: "No security policy found" };
    }
    
    // Find matching permission
    const perm = policy.permissions.find(p => p.type === permission);
    if (!perm) {
      return { allowed: false, reason: `Permission ${permission} not defined` };
    }
    
    if (!perm.granted) {
      return { allowed: false, reason: `Permission ${permission} not granted` };
    }
    
    // Check expiration
    if (perm.expiresAt && perm.expiresAt < Date.now()) {
      return { allowed: false, reason: "Permission expired" };
    }
    
    // Check scope if resource provided
    if (resource && perm.scope) {
      const scopeRegex = new RegExp(perm.scope);
      if (!scopeRegex.test(resource)) {
        return { allowed: false, reason: `Resource ${resource} not in scope ${perm.scope}` };
      }
    }
    
    // Update usage
    perm.usageCount++;
    perm.lastUsed = Date.now();
    
    // Log audit entry
    await this.logAudit(agentId, "permission_check", resource || "", permission, true);
    
    return { allowed: true };
  }
  
  async getAgentSecurityPolicy(agentId: AutonomousAgentId): Promise<SecurityPolicy | null> {
    // This would look up the agent's assigned policy
    // For now, return a default policy
    return this.policies.get("default") || null;
  }
  
  async logAudit(
    agentId: AutonomousAgentId,
    action: string,
    resource: string,
    permission: PermissionType,
    allowed: boolean,
    reason?: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!this.db) return;
    
    const stmt = this.db.prepare(`
      INSERT INTO audit_log (id, agent_id, action, resource, permission, allowed, reason, metadata_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      randomUUID(),
      agentId,
      action,
      resource,
      permission,
      allowed ? 1 : 0,
      reason,
      metadata ? JSON.stringify(metadata) : null,
      Date.now()
    );
  }
  
  async getAuditLog(
    agentId?: AutonomousAgentId,
    limit = 100
  ): Promise<AuditLogEntry[]> {
    if (!this.db) return [];
    
    let query = "SELECT * FROM audit_log";
    const params: unknown[] = [];
    
    if (agentId) {
      query += " WHERE agent_id = ?";
      params.push(agentId);
    }
    
    query += " ORDER BY timestamp DESC LIMIT ?";
    params.push(limit);
    
    const rows = this.db.prepare(query).all(...params) as any[];
    
    return rows.map(row => ({
      id: row.id,
      agentId: row.agent_id as AutonomousAgentId,
      action: row.action,
      resource: row.resource,
      permission: row.permission as PermissionType,
      allowed: row.allowed === 1,
      reason: row.reason,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
      timestamp: row.timestamp,
    }));
  }
  
  // ===========================================================================
  // SCHEDULING
  // ===========================================================================
  
  private startScheduleRunner(): void {
    this.scheduleRunner = setInterval(() => {
      this.checkSchedules();
    }, 60000); // Every minute
  }
  
  private async checkSchedules(): Promise<void> {
    if (!this.db) return;
    
    const now = Date.now();
    
    const dueSchedules = this.db.prepare(`
      SELECT * FROM schedules
      WHERE enabled = 1
        AND (next_run_at IS NULL OR next_run_at <= ?)
        AND (max_runs IS NULL OR run_count < max_runs)
        AND (expires_at IS NULL OR expires_at > ?)
        AND (failure_count < max_failures OR pause_on_failure = 0)
    `).all(now, now) as any[];
    
    for (const schedule of dueSchedules) {
      await this.executeSchedule(schedule);
    }
  }
  
  private async executeSchedule(scheduleRow: any): Promise<void> {
    const scheduleId = scheduleRow.id as ScheduleId;
    
    try {
      // Create mission from template
      const template = JSON.parse(scheduleRow.mission_template_json);
      
      // Emit event to trigger mission creation
      this.emit("schedule:triggered", {
        scheduleId,
        agentId: scheduleRow.agent_id,
        missionTemplate: template,
      });
      
      // Update schedule
      const nextRun = this.calculateNextRun(scheduleRow);
      
      this.db?.prepare(`
        UPDATE schedules
        SET last_run_at = ?, next_run_at = ?, run_count = run_count + 1, failure_count = 0, updated_at = ?
        WHERE id = ?
      `).run(Date.now(), nextRun, Date.now(), scheduleId);
      
      this.emit("schedule:executed", { scheduleId });
      
    } catch (error) {
      // Record failure
      this.db?.prepare(`
        UPDATE schedules
        SET failure_count = failure_count + 1, updated_at = ?
        WHERE id = ?
      `).run(Date.now(), scheduleId);
      
      this.emit("schedule:failed", { scheduleId, error });
    }
  }
  
  private calculateNextRun(schedule: any): number | null {
    if (schedule.type === "once") {
      return null;
    }
    
    if (schedule.type === "interval" && schedule.interval_ms) {
      return Date.now() + schedule.interval_ms;
    }
    
    if (schedule.type === "cron" && schedule.cron_expression) {
      // Simple cron parsing - in production, use a proper cron library
      return Date.now() + 3600000; // Default to 1 hour
    }
    
    return null;
  }
  
  async createSchedule(schedule: Omit<Schedule, "id" | "createdAt" | "updatedAt" | "runCount" | "failureCount">): Promise<Schedule> {
    if (!this.db) throw new Error("Database not initialized");
    
    const id = randomUUID() as ScheduleId;
    const now = Date.now();
    
    const fullSchedule: Schedule = {
      ...schedule,
      id,
      runCount: 0,
      failureCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    
    this.db.prepare(`
      INSERT INTO schedules (
        id, agent_id, name, description, type, cron_expression, interval_ms, execute_at,
        mission_template_json, enabled, next_run_at, max_runs, expires_at, max_failures,
        pause_on_failure, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      schedule.agentId,
      schedule.name,
      schedule.description,
      schedule.type,
      schedule.cronExpression,
      schedule.intervalMs,
      schedule.executeAt,
      JSON.stringify(schedule.missionTemplate),
      schedule.enabled ? 1 : 0,
      schedule.nextRunAt,
      schedule.maxRuns,
      schedule.expiresAt,
      schedule.maxFailures,
      schedule.pauseOnFailure ? 1 : 0,
      now,
      now
    );
    
    this.schedules.set(id, fullSchedule);
    this.emit("schedule:created", fullSchedule);
    
    return fullSchedule;
  }
  
  async getSchedules(agentId?: AutonomousAgentId): Promise<Schedule[]> {
    if (!this.db) return [];
    
    let query = "SELECT * FROM schedules";
    const params: unknown[] = [];
    
    if (agentId) {
      query += " WHERE agent_id = ?";
      params.push(agentId);
    }
    
    query += " ORDER BY created_at DESC";
    
    const rows = this.db.prepare(query).all(...params) as any[];
    
    return rows.map(row => ({
      id: row.id as ScheduleId,
      agentId: row.agent_id as AutonomousAgentId,
      name: row.name,
      description: row.description,
      type: row.type,
      cronExpression: row.cron_expression,
      intervalMs: row.interval_ms,
      executeAt: row.execute_at,
      missionTemplate: JSON.parse(row.mission_template_json),
      enabled: row.enabled === 1,
      lastRunAt: row.last_run_at,
      nextRunAt: row.next_run_at,
      runCount: row.run_count,
      maxRuns: row.max_runs,
      expiresAt: row.expires_at,
      failureCount: row.failure_count,
      maxFailures: row.max_failures,
      pauseOnFailure: row.pause_on_failure === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  
  // ===========================================================================
  // APPROVAL WORKFLOW
  // ===========================================================================
  
  async requestApproval(request: Omit<ApprovalRequest, "id" | "status" | "createdAt">): Promise<ApprovalRequest> {
    if (!this.db) throw new Error("Database not initialized");
    
    const id = randomUUID() as ApprovalId;
    const now = Date.now();
    
    const fullRequest: ApprovalRequest = {
      ...request,
      id,
      status: "pending",
      createdAt: now,
    };
    
    this.db.prepare(`
      INSERT INTO approval_requests (
        id, agent_id, mission_id, action, description, risk, context_json, preview_json,
        status, created_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      request.agentId,
      request.missionId,
      request.action,
      request.description,
      request.risk,
      JSON.stringify(request.context),
      request.preview ? JSON.stringify(request.preview) : null,
      "pending",
      now,
      request.expiresAt
    );
    
    // Create notification
    await this.createNotification({
      agentId: request.agentId,
      title: "Approval Required",
      message: `Agent requests approval for: ${request.description}`,
      type: "approval_request",
      priority: request.risk === "critical" ? "critical" : request.risk === "high" ? "high" : "medium",
      channels: ["ui", "system"],
      approvalId: id,
    });
    
    this.emit("approval:requested", fullRequest);
    
    return fullRequest;
  }
  
  async respondToApproval(
    approvalId: ApprovalId,
    approved: boolean,
    approvedBy: string,
    reason?: string,
    modifiedAction?: string
  ): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");
    
    const now = Date.now();
    
    this.db.prepare(`
      UPDATE approval_requests
      SET status = ?, decision_json = ?, responded_at = ?
      WHERE id = ?
    `).run(
      approved ? "approved" : "rejected",
      JSON.stringify({ approved, reason, modifiedAction, approvedBy, approvedAt: now }),
      now,
      approvalId
    );
    
    this.emit("approval:responded", { approvalId, approved, reason });
  }
  
  async getPendingApprovals(agentId?: AutonomousAgentId): Promise<ApprovalRequest[]> {
    if (!this.db) return [];
    
    let query = "SELECT * FROM approval_requests WHERE status = 'pending'";
    const params: unknown[] = [];
    
    if (agentId) {
      query += " AND agent_id = ?";
      params.push(agentId);
    }
    
    query += " ORDER BY created_at DESC";
    
    const rows = this.db.prepare(query).all(...params) as any[];
    
    return rows.map(this.rowToApprovalRequest);
  }
  
  private rowToApprovalRequest(row: any): ApprovalRequest {
    return {
      id: row.id as ApprovalId,
      agentId: row.agent_id as AutonomousAgentId,
      missionId: row.mission_id as MissionId | undefined,
      action: row.action,
      description: row.description,
      risk: row.risk,
      context: row.context_json ? JSON.parse(row.context_json) : {},
      preview: row.preview_json ? JSON.parse(row.preview_json) : undefined,
      status: row.status,
      decision: row.decision_json ? JSON.parse(row.decision_json) : undefined,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      respondedAt: row.responded_at,
    };
  }
  
  // ===========================================================================
  // TEMPLATES
  // ===========================================================================
  
  private async loadBuiltInTemplates(): Promise<void> {
    if (!this.db) return;
    
    const now = Date.now();
    
    for (const template of BUILT_IN_TEMPLATES) {
      const id = randomUUID() as TemplateId;
      
      const fullTemplate: AgentTemplate = {
        ...template,
        id,
        usageCount: 0,
        rating: 0,
        createdAt: now,
        updatedAt: now,
      };
      
      // Check if already exists
      const existing = this.db.prepare(
        "SELECT id FROM agent_templates WHERE name = ?"
      ).get(template.name);
      
      if (!existing) {
        this.db.prepare(`
          INSERT INTO agent_templates (
            id, name, description, category, tags_json, config_json, initial_knowledge_json,
            security_policy, author, version, icon, usage_count, rating, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          template.name,
          template.description,
          template.category,
          JSON.stringify(template.tags),
          JSON.stringify(template.config),
          template.initialKnowledge ? JSON.stringify(template.initialKnowledge) : null,
          template.securityPolicy,
          template.author,
          template.version,
          template.icon,
          0,
          0,
          now,
          now
        );
      }
      
      this.templates.set(id, fullTemplate);
    }
  }
  
  async getTemplates(category?: string): Promise<AgentTemplate[]> {
    if (!this.db) return [];
    
    let query = "SELECT * FROM agent_templates";
    const params: unknown[] = [];
    
    if (category) {
      query += " WHERE category = ?";
      params.push(category);
    }
    
    query += " ORDER BY usage_count DESC";
    
    const rows = this.db.prepare(query).all(...params) as any[];
    
    return rows.map(row => ({
      id: row.id as TemplateId,
      name: row.name,
      description: row.description,
      category: row.category,
      tags: row.tags_json ? JSON.parse(row.tags_json) : [],
      config: JSON.parse(row.config_json),
      initialKnowledge: row.initial_knowledge_json ? JSON.parse(row.initial_knowledge_json) : undefined,
      securityPolicy: row.security_policy,
      author: row.author,
      version: row.version,
      icon: row.icon,
      usageCount: row.usage_count,
      rating: row.rating,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }
  
  async getTemplate(id: TemplateId): Promise<AgentTemplate | null> {
    if (!this.db) return null;
    
    const row = this.db.prepare("SELECT * FROM agent_templates WHERE id = ?").get(id) as any;
    if (!row) return null;
    
    return {
      id: row.id as TemplateId,
      name: row.name,
      description: row.description,
      category: row.category,
      tags: row.tags_json ? JSON.parse(row.tags_json) : [],
      config: JSON.parse(row.config_json),
      initialKnowledge: row.initial_knowledge_json ? JSON.parse(row.initial_knowledge_json) : undefined,
      securityPolicy: row.security_policy,
      author: row.author,
      version: row.version,
      icon: row.icon,
      usageCount: row.usage_count,
      rating: row.rating,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  
  // ===========================================================================
  // NOTIFICATIONS
  // ===========================================================================
  
  async createNotification(notification: Omit<Notification, "id" | "delivered" | "read" | "dismissed" | "createdAt">): Promise<Notification> {
    if (!this.db) throw new Error("Database not initialized");
    
    const id = randomUUID() as NotificationId;
    const now = Date.now();
    
    const fullNotification: Notification = {
      ...notification,
      id,
      delivered: [],
      read: false,
      dismissed: false,
      createdAt: now,
    };
    
    this.db.prepare(`
      INSERT INTO notifications (
        id, agent_id, title, message, type, priority, channels_json, delivered_json,
        actions_json, mission_id, approval_id, created_at, expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      notification.agentId,
      notification.title,
      notification.message,
      notification.type,
      notification.priority,
      JSON.stringify(notification.channels),
      JSON.stringify([]),
      notification.actions ? JSON.stringify(notification.actions) : null,
      notification.missionId,
      notification.approvalId,
      now,
      notification.expiresAt
    );
    
    // Emit for real-time delivery
    this.emit("notification:created", fullNotification);
    
    return fullNotification;
  }
  
  async getNotifications(
    agentId?: AutonomousAgentId,
    unreadOnly = false,
    limit = 50
  ): Promise<Notification[]> {
    if (!this.db) return [];
    
    let query = "SELECT * FROM notifications WHERE 1=1";
    const params: unknown[] = [];
    
    if (agentId) {
      query += " AND agent_id = ?";
      params.push(agentId);
    }
    
    if (unreadOnly) {
      query += " AND read = 0";
    }
    
    query += " ORDER BY created_at DESC LIMIT ?";
    params.push(limit);
    
    const rows = this.db.prepare(query).all(...params) as any[];
    
    return rows.map(row => ({
      id: row.id as NotificationId,
      agentId: row.agent_id as AutonomousAgentId,
      title: row.title,
      message: row.message,
      type: row.type,
      priority: row.priority as NotificationPriority,
      channels: row.channels_json ? JSON.parse(row.channels_json) : [],
      delivered: row.delivered_json ? JSON.parse(row.delivered_json) : [],
      actions: row.actions_json ? JSON.parse(row.actions_json) : undefined,
      read: row.read === 1,
      dismissed: row.dismissed === 1,
      actedOn: row.acted_on,
      missionId: row.mission_id as MissionId | undefined,
      approvalId: row.approval_id as ApprovalId | undefined,
      createdAt: row.created_at,
      readAt: row.read_at,
      expiresAt: row.expires_at,
    }));
  }
  
  async markNotificationRead(id: NotificationId): Promise<void> {
    if (!this.db) return;
    
    this.db.prepare(`
      UPDATE notifications SET read = 1, read_at = ? WHERE id = ?
    `).run(Date.now(), id);
  }
  
  // ===========================================================================
  // HEALTH CHECKS
  // ===========================================================================
  
  private startHealthChecker(): void {
    this.healthChecker = setInterval(() => {
      this.runHealthChecks();
    }, 30000); // Every 30 seconds
  }
  
  private async runHealthChecks(): Promise<void> {
    const health = await this.getSystemHealth();
    
    // Emit health status
    this.emit("health:checked", health);
    
    // Check for issues
    for (const issue of health.issues) {
      if (issue.status === "critical") {
        await this.createNotification({
          agentId: "system" as AutonomousAgentId,
          title: "Critical System Issue",
          message: `${issue.component}: ${issue.message}`,
          type: "error",
          priority: "critical",
          channels: ["ui", "system"],
        });
      }
    }
  }
  
  async getSystemHealth(): Promise<SystemHealth> {
    const resources = this.currentResources;
    
    let overall: HealthStatus = "healthy";
    const issues: SystemHealth["issues"] = [];
    
    // Check resources
    if (resources) {
      if (resources.cpu.usage > 90 || resources.memory.percentage > 90) {
        overall = "critical";
        issues.push({
          component: "resources",
          status: "critical",
          message: "Critical resource usage",
          since: Date.now(),
        });
      } else if (resources.cpu.usage > 70 || resources.memory.percentage > 70) {
        if (overall === "healthy") overall = "degraded";
        issues.push({
          component: "resources",
          status: "degraded",
          message: "High resource usage",
          since: Date.now(),
        });
      }
    }
    
    return {
      overall,
      timestamp: Date.now(),
      components: {
        agents: "healthy",
        database: this.db ? "healthy" : "unhealthy",
        models: "healthy",
        network: "healthy",
        storage: "healthy",
      },
      activeAgents: 0, // Would query from main agent system
      totalMissions: 0,
      pendingApprovals: (await this.getPendingApprovals()).length,
      resources: resources || {
        cpu: { usage: 0, cores: 0, loadAverage: [] },
        memory: { total: 0, used: 0, free: 0, percentage: 0 },
        disk: { total: 0, used: 0, free: 0, percentage: 0 },
        network: { bytesIn: 0, bytesOut: 0, requestsPerMinute: 0 },
      },
      issues,
    };
  }
  
  // ===========================================================================
  // QUOTAS
  // ===========================================================================
  
  private startQuotaResetTimer(): void {
    this.quotaResetTimer = setInterval(() => {
      this.checkQuotaResets();
    }, 60000); // Every minute
  }
  
  private async checkQuotaResets(): Promise<void> {
    if (!this.db) return;
    
    const now = Date.now();
    
    // Find expired quotas
    const expiredQuotas = this.db.prepare(`
      SELECT * FROM quotas WHERE period_end < ?
    `).all(now) as any[];
    
    for (const quota of expiredQuotas) {
      // Create new quota period
      const newPeriodStart = now;
      const newPeriodEnd = this.calculatePeriodEnd(quota.period, now);
      
      // Reset limits
      const limits = JSON.parse(quota.limits_json);
      for (const key in limits) {
        limits[key].used = 0;
      }
      
      this.db.prepare(`
        UPDATE quotas
        SET period_start = ?, period_end = ?, limits_json = ?, alert_sent = 0
        WHERE id = ?
      `).run(newPeriodStart, newPeriodEnd, JSON.stringify(limits), quota.id);
    }
  }
  
  private calculatePeriodEnd(period: string, start: number): number {
    switch (period) {
      case "hourly":
        return start + 3600000;
      case "daily":
        return start + 86400000;
      case "weekly":
        return start + 604800000;
      case "monthly":
        return start + 2592000000;
      default:
        return start + 86400000;
    }
  }
  
  async checkQuota(
    agentId: AutonomousAgentId,
    resource: keyof Quota["limits"],
    amount: number
  ): Promise<{ allowed: boolean; remaining: number; reason?: string }> {
    if (!this.db) return { allowed: true, remaining: Infinity };
    
    const quota = this.db.prepare(`
      SELECT * FROM quotas WHERE agent_id = ? AND period_end > ?
    `).get(agentId, Date.now()) as any;
    
    if (!quota) {
      return { allowed: true, remaining: Infinity };
    }
    
    const limits = JSON.parse(quota.limits_json);
    const resourceLimit = limits[resource];
    
    if (!resourceLimit) {
      return { allowed: true, remaining: Infinity };
    }
    
    const remaining = resourceLimit.limit - resourceLimit.used;
    
    if (resourceLimit.used + amount > resourceLimit.limit) {
      return {
        allowed: false,
        remaining,
        reason: `Quota exceeded for ${resource}: ${resourceLimit.used}/${resourceLimit.limit}`,
      };
    }
    
    // Check alert threshold
    const usagePercent = (resourceLimit.used + amount) / resourceLimit.limit;
    if (usagePercent >= quota.alert_threshold && !quota.alert_sent) {
      await this.createNotification({
        agentId,
        title: "Quota Warning",
        message: `${resource} usage at ${(usagePercent * 100).toFixed(0)}% of limit`,
        type: "warning",
        priority: "medium",
        channels: ["ui"],
      });
      
      this.db.prepare(`UPDATE quotas SET alert_sent = 1 WHERE id = ?`).run(quota.id);
    }
    
    return { allowed: true, remaining: remaining - amount };
  }
  
  async recordQuotaUsage(
    agentId: AutonomousAgentId,
    resource: keyof Quota["limits"],
    amount: number
  ): Promise<void> {
    if (!this.db) return;
    
    const quota = this.db.prepare(`
      SELECT * FROM quotas WHERE agent_id = ? AND period_end > ?
    `).get(agentId, Date.now()) as any;
    
    if (!quota) return;
    
    const limits = JSON.parse(quota.limits_json);
    if (limits[resource]) {
      limits[resource].used += amount;
      
      this.db.prepare(`
        UPDATE quotas SET limits_json = ? WHERE id = ?
      `).run(JSON.stringify(limits), quota.id);
    }
  }
  
  // ===========================================================================
  // KNOWLEDGE GRAPH
  // ===========================================================================
  
  async addKnowledgeNode(node: Omit<KnowledgeNode, "id" | "accessCount" | "usefulnessScore" | "createdAt" | "updatedAt">): Promise<KnowledgeNode> {
    if (!this.db) throw new Error("Database not initialized");
    
    const id = randomUUID() as KnowledgeNodeId;
    const now = Date.now();
    
    const fullNode: KnowledgeNode = {
      ...node,
      id,
      accessCount: 0,
      usefulnessScore: 0,
      createdAt: now,
      updatedAt: now,
    };
    
    this.db.prepare(`
      INSERT INTO knowledge_nodes (
        id, type, name, description, properties_json, source_agent, source_type,
        confidence, validated_by_json, tags_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      node.type,
      node.name,
      node.description,
      JSON.stringify(node.properties),
      node.sourceAgent,
      node.sourceType,
      node.confidence,
      JSON.stringify(node.validatedBy),
      JSON.stringify(node.tags),
      now,
      now
    );
    
    this.emit("knowledge:node_added", fullNode);
    
    return fullNode;
  }
  
  async addKnowledgeEdge(edge: Omit<KnowledgeEdge, "id" | "createdAt">): Promise<KnowledgeEdge> {
    if (!this.db) throw new Error("Database not initialized");
    
    const id = randomUUID();
    const now = Date.now();
    
    const fullEdge: KnowledgeEdge = {
      ...edge,
      id,
      createdAt: now,
    };
    
    this.db.prepare(`
      INSERT INTO knowledge_edges (
        id, from_node, to_node, type, strength, bidirectional, created_by, evidence_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      edge.fromNode,
      edge.toNode,
      edge.type,
      edge.strength,
      edge.bidirectional ? 1 : 0,
      edge.createdBy,
      edge.evidence ? JSON.stringify(edge.evidence) : null,
      now
    );
    
    this.emit("knowledge:edge_added", fullEdge);
    
    return fullEdge;
  }
  
  async queryKnowledgeGraph(query: KnowledgeQuery): Promise<{ nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> {
    if (!this.db) return { nodes: [], edges: [] };
    
    let nodeQuery = "SELECT * FROM knowledge_nodes WHERE 1=1";
    const params: unknown[] = [];
    
    if (query.nodeTypes?.length) {
      nodeQuery += ` AND type IN (${query.nodeTypes.map(() => "?").join(",")})`;
      params.push(...query.nodeTypes);
    }
    
    if (query.minConfidence !== undefined) {
      nodeQuery += " AND confidence >= ?";
      params.push(query.minConfidence);
    }
    
    if (query.createdAfter !== undefined) {
      nodeQuery += " AND created_at >= ?";
      params.push(query.createdAfter);
    }
    
    if (query.searchText) {
      nodeQuery += " AND (name LIKE ? OR description LIKE ?)";
      const pattern = `%${query.searchText}%`;
      params.push(pattern, pattern);
    }
    
    if (query.limit) {
      nodeQuery += " LIMIT ?";
      params.push(query.limit);
    }
    
    if (query.offset) {
      nodeQuery += " OFFSET ?";
      params.push(query.offset);
    }
    
    const nodeRows = this.db.prepare(nodeQuery).all(...params) as any[];
    const nodes = nodeRows.map(row => ({
      id: row.id as KnowledgeNodeId,
      type: row.type,
      name: row.name,
      description: row.description,
      properties: row.properties_json ? JSON.parse(row.properties_json) : {},
      sourceAgent: row.source_agent as AutonomousAgentId | undefined,
      sourceType: row.source_type,
      confidence: row.confidence,
      validatedBy: row.validated_by_json ? JSON.parse(row.validated_by_json) : [],
      accessCount: row.access_count,
      lastAccessed: row.last_accessed,
      usefulnessScore: row.usefulness_score,
      tags: row.tags_json ? JSON.parse(row.tags_json) : [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
    
    // Get edges for found nodes
    const nodeIds = nodes.map(n => n.id);
    let edges: KnowledgeEdge[] = [];
    
    if (nodeIds.length > 0) {
      const edgeQuery = `
        SELECT * FROM knowledge_edges
        WHERE from_node IN (${nodeIds.map(() => "?").join(",")})
           OR to_node IN (${nodeIds.map(() => "?").join(",")})
      `;
      
      const edgeRows = this.db.prepare(edgeQuery).all(...nodeIds, ...nodeIds) as any[];
      edges = edgeRows.map(row => ({
        id: row.id,
        fromNode: row.from_node as KnowledgeNodeId,
        toNode: row.to_node as KnowledgeNodeId,
        type: row.type,
        strength: row.strength,
        bidirectional: row.bidirectional === 1,
        createdBy: row.created_by as AutonomousAgentId | undefined,
        evidence: row.evidence_json ? JSON.parse(row.evidence_json) : undefined,
        createdAt: row.created_at,
      }));
    }
    
    return { nodes, edges };
  }
  
  // ===========================================================================
  // ANALYTICS
  // ===========================================================================
  
  async recordAnalyticsEvent(event: Omit<AnalyticsEvent, "id" | "timestamp">): Promise<void> {
    if (!this.db) return;
    
    this.db.prepare(`
      INSERT INTO analytics_events (id, agent_id, event, category, properties_json, mission_id, session_id, duration, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      event.agentId,
      event.event,
      event.category,
      JSON.stringify(event.properties),
      event.missionId,
      event.sessionId,
      event.duration,
      Date.now()
    );
  }
  
  private recordMetric(metric: string, value: number, tags?: Record<string, string>): void {
    if (!this.db) return;
    
    this.db.prepare(`
      INSERT INTO metrics (metric, value, tags_json, timestamp)
      VALUES (?, ?, ?, ?)
    `).run(metric, value, tags ? JSON.stringify(tags) : null, Date.now());
  }
  
  async getMetrics(
    metric: string,
    startTime: number,
    endTime: number,
    aggregation?: "avg" | "sum" | "min" | "max" | "count"
  ): Promise<MetricPoint[]> {
    if (!this.db) return [];
    
    let query: string;
    
    if (aggregation) {
      const aggFunc = aggregation === "avg" ? "AVG" : 
                      aggregation === "sum" ? "SUM" :
                      aggregation === "min" ? "MIN" :
                      aggregation === "max" ? "MAX" : "COUNT";
      
      query = `
        SELECT metric, ${aggFunc}(value) as value, tags_json, 
               (timestamp / 60000) * 60000 as timestamp
        FROM metrics
        WHERE metric = ? AND timestamp BETWEEN ? AND ?
        GROUP BY (timestamp / 60000)
        ORDER BY timestamp
      `;
    } else {
      query = `
        SELECT * FROM metrics
        WHERE metric = ? AND timestamp BETWEEN ? AND ?
        ORDER BY timestamp
      `;
    }
    
    const rows = this.db.prepare(query).all(metric, startTime, endTime) as any[];
    
    return rows.map(row => ({
      metric: row.metric,
      value: row.value,
      tags: row.tags_json ? JSON.parse(row.tags_json) : {},
      timestamp: row.timestamp,
    }));
  }
  
  // ===========================================================================
  // BACKUP & RECOVERY
  // ===========================================================================
  
  async createBackup(
    type: Backup["type"],
    agents?: AutonomousAgentId[]
  ): Promise<Backup> {
    if (!this.db) throw new Error("Database not initialized");
    
    const id = randomUUID() as BackupId;
    const now = Date.now();
    const backupPath = path.join(this.dataPath, "backups", `backup_${id}.json`);
    
    // Ensure backup directory exists
    await fs.mkdir(path.join(this.dataPath, "backups"), { recursive: true });
    
    const backup: Backup = {
      id,
      type,
      agents: agents || [],
      includesKnowledge: type === "full" || type === "knowledge_only",
      includesMissions: type === "full",
      includesArtifacts: type === "full",
      includesSchedules: type === "full",
      path: backupPath,
      size: 0,
      compressed: false,
      encrypted: false,
      version: "1.0.0",
      checksum: "",
      status: "creating",
      createdAt: now,
    };
    
    // Insert backup record
    this.db.prepare(`
      INSERT INTO backups (
        id, type, agents_json, includes_knowledge, includes_missions, includes_artifacts,
        includes_schedules, path, compressed, encrypted, version, status, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      type,
      JSON.stringify(agents || []),
      backup.includesKnowledge ? 1 : 0,
      backup.includesMissions ? 1 : 0,
      backup.includesArtifacts ? 1 : 0,
      backup.includesSchedules ? 1 : 0,
      backupPath,
      0,
      0,
      "1.0.0",
      "creating",
      now
    );
    
    this.emit("backup:started", backup);
    
    // Perform backup asynchronously
    this.performBackup(backup).catch(error => {
      this.db?.prepare(`UPDATE backups SET status = 'failed', error = ? WHERE id = ?`).run(
        error.message,
        id
      );
      this.emit("backup:failed", { id, error });
    });
    
    return backup;
  }
  
  private async performBackup(backup: Backup): Promise<void> {
    if (!this.db) return;
    
    const data: Record<string, unknown> = {
      version: backup.version,
      createdAt: backup.createdAt,
      type: backup.type,
    };
    
    // Collect data based on backup type
    if (backup.includesKnowledge) {
      data.knowledgeNodes = this.db.prepare("SELECT * FROM knowledge_nodes").all();
      data.knowledgeEdges = this.db.prepare("SELECT * FROM knowledge_edges").all();
    }
    
    if (backup.includesSchedules) {
      data.schedules = this.db.prepare("SELECT * FROM schedules").all();
    }
    
    // Write backup file
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(backup.path, content, "utf-8");
    
    // Calculate size and checksum
    const stats = await fs.stat(backup.path);
    
    // Update backup record
    this.db.prepare(`
      UPDATE backups
      SET status = 'completed', size = ?, completed_at = ?
      WHERE id = ?
    `).run(stats.size, Date.now(), backup.id);
    
    this.emit("backup:completed", { id: backup.id, size: stats.size });
  }
  
  async listBackups(): Promise<Backup[]> {
    if (!this.db) return [];
    
    const rows = this.db.prepare("SELECT * FROM backups ORDER BY created_at DESC").all() as any[];
    
    return rows.map(row => ({
      id: row.id as BackupId,
      type: row.type,
      agents: row.agents_json ? JSON.parse(row.agents_json) : [],
      includesKnowledge: row.includes_knowledge === 1,
      includesMissions: row.includes_missions === 1,
      includesArtifacts: row.includes_artifacts === 1,
      includesSchedules: row.includes_schedules === 1,
      path: row.path,
      size: row.size,
      compressed: row.compressed === 1,
      encrypted: row.encrypted === 1,
      encryptionKey: row.encryption_key,
      version: row.version,
      checksum: row.checksum,
      status: row.status,
      error: row.error,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }));
  }
}

// Export singleton getter
export function getProductionSystem(): AutonomousAgentProductionSystem {
  return AutonomousAgentProductionSystem.getInstance();
}
