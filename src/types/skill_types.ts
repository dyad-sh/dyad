/**
 * Skill System Types
 * Types for the reusable, marketplace-sellable skill system.
 */

import type { AgentCapability } from "./agent_factory_types";
import type { SkillTriggerPattern, SkillExampleRecord, SkillKind, SkillImplType, SkillPublishStatus } from "../db/schema";

// Re-export DB types for convenience
export type { SkillTriggerPattern, SkillExampleRecord, SkillKind, SkillImplType, SkillPublishStatus };

// =============================================================================
// CORE SKILL TYPE
// =============================================================================

export interface Skill {
  id: number;
  name: string;
  description: string;
  category: AgentCapability;
  type: SkillKind;
  implementationType: SkillImplType;
  implementationCode: string | null;
  triggerPatterns: SkillTriggerPattern[];
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  examples: SkillExampleRecord[];
  tags: string[];
  version: string;
  authorId: string | null;
  publishStatus: SkillPublishStatus;
  marketplaceId: string | null;
  price: number;
  currency: string;
  downloads: number;
  rating: number;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// SKILL TRIGGER & MATCHING
// =============================================================================

export interface SkillTriggerMatch {
  skillId: number;
  skill: Skill;
  confidence: number; // 0-1
  matchedPattern: SkillTriggerPattern;
  matchedText: string;
}

// =============================================================================
// SKILL EXECUTION
// =============================================================================

export interface SkillExecutionContext {
  /** The agent executing the skill (if any) */
  agentId?: string;
  /** The platform (telegram / discord / web) */
  platform?: "telegram" | "discord" | "web";
  /** The user who triggered the execution */
  userId?: string;
  /** Conversation history for context */
  conversationHistory?: Array<{ role: string; content: string }>;
}

export interface SkillExecutionResult {
  success: boolean;
  output: string;
  /** Milliseconds taken */
  duration: number;
  /** Error message if failed */
  error?: string;
}

// =============================================================================
// SKILL CRUD PARAMS
// =============================================================================

export interface CreateSkillParams {
  name: string;
  description: string;
  category: AgentCapability;
  type?: SkillKind;
  implementationType: SkillImplType;
  implementationCode?: string;
  triggerPatterns?: SkillTriggerPattern[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  examples?: SkillExampleRecord[];
  tags?: string[];
}

export interface UpdateSkillParams {
  id: number;
  name?: string;
  description?: string;
  category?: AgentCapability;
  type?: SkillKind;
  implementationType?: SkillImplType;
  implementationCode?: string;
  triggerPatterns?: SkillTriggerPattern[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  examples?: SkillExampleRecord[];
  tags?: string[];
  enabled?: boolean;
  version?: string;
}

export interface SkillSearchParams {
  query?: string;
  category?: AgentCapability;
  type?: SkillKind;
  tags?: string[];
  publishStatus?: SkillPublishStatus;
  enabled?: boolean;
  limit?: number;
  offset?: number;
}

// =============================================================================
// SKILL ↔ AGENT LINKING
// =============================================================================

export interface AttachSkillParams {
  agentId: number;
  skillId: number;
}

export interface DetachSkillParams {
  agentId: number;
  skillId: number;
}

// =============================================================================
// NLP SKILL GENERATION
// =============================================================================

export interface SkillGenerationRequest {
  /** Plain English description of the desired skill */
  description: string;
  /** Optional category hint */
  category?: AgentCapability;
  /** Optional examples to guide generation */
  examples?: Array<{ input: string; output: string }>;
}

export interface SkillGenerationResult {
  skill: CreateSkillParams;
  /** Confidence the AI has in the generated skill */
  confidence: number;
  /** Suggested test cases */
  suggestedTests: SkillExampleRecord[];
}

// =============================================================================
// SKILL MARKETPLACE
// =============================================================================

export interface SkillPublishRequest {
  skillId: number;
  price?: number;
  currency?: string;
}

export interface SkillInstallRequest {
  marketplaceId: string;
}

// =============================================================================
// SKILL EXECUTE PARAMS (IPC)
// =============================================================================

export interface ExecuteSkillParams {
  skillId: number;
  input: string;
  context?: SkillExecutionContext;
}
