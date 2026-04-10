/**
 * OpenClaw Autonomous Types
 *
 * Types for the unified autonomous orchestration system that connects
 * all JoyCreate features — apps, marketplace, agents, workflows,
 * documents, email, studios, and more.
 */

// ── Action Catalog ─────────────────────────────────────────────────────────

/** Every dispatchable feature in JoyCreate */
export type ActionCategory =
  | "app"
  | "marketplace"
  | "agent"
  | "workflow"
  | "email"
  | "image"
  | "video"
  | "scraper"
  | "deploy"
  | "github"
  | "data"
  | "system"
  | "mission";

export interface ActionDefinition {
  id: string;
  category: ActionCategory;
  name: string;
  description: string;
  parameters: ActionParam[];
  /** IPC channel this action dispatches to (main process) */
  channel: string;
}

export interface ActionParam {
  name: string;
  type: "string" | "number" | "boolean" | "object";
  required: boolean;
  description: string;
}

// ── Execution ──────────────────────────────────────────────────────────────

export type ExecutionStatus =
  | "pending"
  | "planning"
  | "executing"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export interface PlannedStep {
  id: string;
  actionId: string;
  description: string;
  params: Record<string, unknown>;
  dependencies: string[];
  status: ExecutionStatus;
  result?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface ExecutionPlan {
  id: string;
  objective: string;
  reasoning: string;
  steps: PlannedStep[];
  createdAt: string;
}

export interface AutonomousExecution {
  id: string;
  input: string;
  status: ExecutionStatus;
  plan?: ExecutionPlan;
  currentStepIndex: number;
  progress: number;
  results: StepResult[];
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface StepResult {
  stepId: string;
  actionId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  durationMs: number;
}

// ── Request / Response ─────────────────────────────────────────────────────

export interface AutonomousRequest {
  input: string;
  /** Optional context: which app, which agent, etc. */
  context?: {
    appId?: number;
    agentId?: number;
    walletAddress?: string;
  };
  /** Let AI plan but require human approval before executing */
  requireApproval?: boolean;
  /** Only plan, don't execute */
  planOnly?: boolean;
}

export interface AutonomousStatus {
  initialized: boolean;
  activeExecutions: number;
  completedExecutions: number;
  failedExecutions: number;
  availableActions: number;
}
