// =============================================================================
// Multi-Armed Bandit Learning Types
// Local-first continuous learning via Thompson Sampling
// =============================================================================

/** Broad category of what the arm represents */
export type MABDomain =
  | "model_selection"       // Which AI model to use
  | "connector_strategy"    // Which connector / ingestion config works best
  | "transform_pipeline"    // Which transform stages produce best results
  | "prompt_template"       // Which prompt template gets best results
  | "ui_layout"             // Which UI layout / setting is preferred
  | "response_style"        // Concise vs detailed etc.
  | "tool_selection"        // Which tool / MCP to invoke
  | "workflow_routing"      // Which workflow path to take
  | "custom";               // User-defined domain

/** A single arm in a bandit problem */
export interface MABArm {
  id: string;               // UUID
  domain: MABDomain;
  name: string;
  description?: string;
  contextKey: string;       // Groups arms that compete (e.g. "chat-model-select")

  // Beta distribution parameters (Thompson Sampling)
  alpha: number;            // Successes + 1
  beta: number;             // Failures + 1
  pulls: number;            // Total times selected
  totalReward: number;      // Cumulative reward (0-1 per pull)

  // Derived stats (recomputed on read)
  meanReward: number;       // alpha / (alpha + beta)
  winRate: number;          // totalReward / pulls (NaN-safe, 0 if no pulls)
  confidence: number;       // 0..1 — how converged the posterior is

  // Metadata
  metadataJson: Record<string, unknown> | null;
  isActive: boolean;
  lastRewardAt: number | null;  // epoch ms — last reward timestamp
  createdAt: number;        // epoch ms
  updatedAt: number;
}

/** A single reward event recorded for an arm */
export interface MABRewardEvent {
  id: string;               // UUID
  armId: string;
  reward: number;           // 0.0 – 1.0
  contextJson: Record<string, unknown> | null; // Contextual features
  feedback?: string;        // Optional user comment
  source: "auto" | "user" | "system";
  createdAt: number;
}

/** Summary stats across the whole MAB system */
export interface MABStats {
  totalArms: number;
  totalPulls: number;
  totalReward: number;
  domainBreakdown: Record<MABDomain, { arms: number; pulls: number; avgReward: number }>;
  topArms: MABArm[];        // Top 5 by mean reward
  recentEvents: MABRewardEvent[];
}

/** Parameters to create a new arm */
export interface CreateArmParams {
  domain: MABDomain;
  name: string;
  description?: string;
  contextKey: string;
  metadata?: Record<string, unknown>;
}

/** Parameters to record a reward */
export interface RecordRewardParams {
  armId: string;
  reward: number;           // 0.0 – 1.0
  context?: Record<string, unknown>;
  feedback?: string;
  source?: "auto" | "user" | "system";
}

/** Parameters to select the best arm (Thompson Sampling) */
export interface SelectArmParams {
  contextKey: string;
  explorationBonus?: number; // Extra exploration weight (default 1.0)
}

/** Result of arm selection */
export interface SelectArmResult {
  arm: MABArm;
  sampledValue: number;     // The Thompson sample that won
  explorationRatio: number; // How much of the choice was exploration vs exploitation
}

/** Decay configuration */
export interface MABDecayConfig {
  enabled: boolean;
  halfLifeDays: number;     // Rewards older than this get half weight
  minPulls: number;         // Minimum pulls before decay applies
}
