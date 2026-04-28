/**
 * Autonomous Agent System
 * A fully autonomous, perpetually growing AI system that can:
 * - Scrape data it needs from the web
 * - Download and use AI models
 * - Generate and execute code
 * - Create UI components
 * - Add voice capabilities (Piper/Whisper)
 * - Self-replicate and evolve
 * - Learn and improve continuously
 */

import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { existsSync, createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { spawn, ChildProcess, exec } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { getOpenClawSystemIntegration } from "@/lib/openclaw_system_integration";
import { generateText } from "ai";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { readSettings } from "@/main/settings";
import {
  executeViaBridge,
  hasBridgedTool,
  type BridgeConfig,
} from "@/lib/autonomous_tool_bridge";

const execAsync = promisify(exec);

// =============================================================================
// BRANDED TYPES
// =============================================================================

export type AutonomousAgentId = string & { __brand: "AutonomousAgentId" };
export type MissionId = string & { __brand: "MissionId" };
export type EvolutionId = string & { __brand: "EvolutionId" };
export type ArtifactId = string & { __brand: "ArtifactId" };
export type CapabilityId = string & { __brand: "CapabilityId" };
export type LearningId = string & { __brand: "LearningId" };

// =============================================================================
// CORE TYPES
// =============================================================================

export type AgentLifecycleState = 
  | "dormant"         // Not yet activated
  | "initializing"    // Setting up capabilities
  | "active"          // Running autonomously
  | "learning"        // Acquiring new knowledge/skills
  | "evolving"        // Self-improving
  | "replicating"     // Creating offspring
  | "hibernating"     // Temporarily inactive
  | "terminated";     // Permanently stopped

export type MissionType =
  | "research"        // Gather information
  | "build"           // Create something
  | "analyze"         // Examine data/code
  | "optimize"        // Improve existing
  | "integrate"       // Combine systems
  | "automate"        // Create automation
  | "evolve"          // Self-improvement
  | "replicate"       // Create offspring
  | "custom";

export type MissionStatus = "pending" | "planning" | "executing" | "validating" | "completed" | "failed" | "abandoned";

export type CapabilityType =
  | "scraping"        // Web data extraction
  | "code_generation" // Create code
  | "ui_generation"   // Create interfaces
  | "voice_input"     // Speech-to-text
  | "voice_output"    // Text-to-speech
  | "model_usage"     // AI model inference
  | "model_training"  // Fine-tuning
  | "data_analysis"   // Analyze data
  | "file_operations" // Read/write files
  | "terminal"        // Run commands
  | "web_browsing"    // Browse websites
  | "api_calls"       // Make API requests
  | "database"        // Database operations
  | "learning"        // Self-improvement
  | "replication";    // Create copies

export type ArtifactType =
  | "code"           // Source code
  | "component"      // UI component
  | "dataset"        // Scraped/generated data
  | "model"          // AI model
  | "config"         // Configuration
  | "documentation"  // Docs
  | "knowledge"      // Learned knowledge
  | "voice_model"    // TTS/STT model
  | "agent_clone";   // Replicated agent

// =============================================================================
// INTERFACES
// =============================================================================

export interface AutonomousAgent {
  id: AutonomousAgentId;
  name: string;
  purpose: string;
  state: AgentLifecycleState;
  generation: number;
  parentId: AutonomousAgentId | null;
  childIds: AutonomousAgentId[];
  
  // Core Configuration
  config: AgentConfiguration;
  
  // Capabilities (what it can do)
  capabilities: AgentCapability[];
  
  // Current state
  currentMission: MissionId | null;
  missionQueue: MissionId[];
  
  // Learning & Evolution
  knowledge: KnowledgeBase;
  evolutionHistory: EvolutionRecord[];
  
  // Performance metrics
  metrics: AgentPerformanceMetrics;
  
  // Timestamps
  createdAt: number;
  activatedAt?: number;
  lastActiveAt?: number;
  terminatedAt?: number;
}

export interface AgentConfiguration {
  // AI Model settings
  primaryModel: string;
  fallbackModels: string[];
  temperature: number;
  maxTokens: number;
  
  // Autonomy settings
  autonomyLevel: "supervised" | "semi-autonomous" | "fully-autonomous";
  requiresApproval: string[]; // Actions needing approval
  maxActionsPerHour: number;
  
  // Resource limits
  maxMemoryMb: number;
  maxCpuPercent: number;
  maxStorageMb: number;
  
  // Evolution settings
  canEvolve: boolean;
  canReplicate: boolean;
  maxGenerations: number;
  mutationRate: number;
  
  // Voice settings
  voiceEnabled: boolean;
  voiceModel: "piper" | "whisper" | "both";
  voiceLanguage: string;
  
  // Learning settings
  learningEnabled: boolean;
  learningRate: number;
  knowledgeRetention: number;
}

export interface AgentCapability {
  id: CapabilityId;
  type: CapabilityType;
  name: string;
  description: string;
  proficiency: number; // 0-1
  enabled: boolean;
  
  // Dependencies
  requires: CapabilityId[];
  
  // Resource requirements
  resources: CapabilityResources;
  
  // Learning data
  usageCount: number;
  successRate: number;
  lastUsed?: number;
  learnedFrom?: AutonomousAgentId;
}

export interface CapabilityResources {
  modelRequired?: string;
  toolsRequired: string[];
  memoryMb: number;
  timeoutMs: number;
}

export interface Mission {
  id: MissionId;
  agentId: AutonomousAgentId;
  type: MissionType;
  status: MissionStatus;
  
  // Mission definition
  objective: string;
  context: string;
  constraints: string[];
  successCriteria: string[];
  
  // Planning
  plan: MissionPlan | null;
  
  // Execution
  currentPhase: number;
  phases: MissionPhase[];
  
  // Results
  artifacts: ArtifactId[];
  learnings: LearningRecord[];
  
  // Metrics
  startedAt?: number;
  completedAt?: number;
  tokensUsed: number;
  actionsPerformed: number;
  errorsEncountered: number;
  
  // Parent mission for sub-tasks
  parentMissionId?: MissionId;
  subMissionIds: MissionId[];
  
  createdAt: number;
}

export interface MissionPlan {
  id: string;
  phases: MissionPhase[];
  estimatedDuration: number;
  estimatedTokens: number;
  requiredCapabilities: CapabilityType[];
  risks: PlanRisk[];
  createdAt: number;
}

export interface MissionPhase {
  id: string;
  name: string;
  description: string;
  type: PhaseType;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  
  // Actions in this phase
  actions: PhaseAction[];
  
  // Dependencies
  dependsOn: string[]; // Other phase IDs
  
  // Results
  output?: unknown;
  error?: string;
  
  startedAt?: number;
  completedAt?: number;
}

export type PhaseType =
  | "research"
  | "planning"
  | "data_acquisition"
  | "code_generation"
  | "ui_generation"
  | "model_setup"
  | "voice_setup"
  | "testing"
  | "validation"
  | "deployment"
  | "learning"
  | "analysis";

export interface PhaseAction {
  id: string;
  type: ActionType;
  description: string;
  status: "pending" | "executing" | "completed" | "failed";
  
  // Action details
  params: Record<string, unknown>;
  
  // Results
  result?: ActionResult;
  error?: string;
  
  // Timing
  startedAt?: number;
  completedAt?: number;
  duration?: number;
}

export type ActionType =
  // Data acquisition
  | "scrape_webpage"
  | "scrape_api"
  | "search_web"
  | "download_resource"
  
  // AI operations
  | "model_inference"
  | "model_download"
  | "model_setup"
  
  // Code operations
  | "generate_code"
  | "edit_code"
  | "analyze_code"
  | "run_code"
  | "test_code"
  
  // UI operations
  | "generate_component"
  | "generate_page"
  | "generate_style"
  
  // Voice operations
  | "setup_voice"
  | "transcribe_audio"
  | "synthesize_speech"
  
  // File operations
  | "read_file"
  | "write_file"
  | "create_directory"
  | "delete_file"
  
  // Terminal operations
  | "run_command"
  | "install_dependency"
  
  // Learning
  | "analyze_result"
  | "extract_pattern"
  | "update_knowledge"
  
  // Agent operations
  | "spawn_subagent"
  | "evolve_self"
  | "replicate";

export interface ActionResult {
  success: boolean;
  output?: unknown;
  artifacts?: ArtifactId[];
  learnings?: string[];
  error?: string;
  metrics?: {
    tokensUsed?: number;
    timeMs?: number;
    bytesProcessed?: number;
  };
}

export interface PlanRisk {
  id: string;
  description: string;
  probability: number;
  impact: "low" | "medium" | "high" | "critical";
  mitigation: string;
}

export interface Artifact {
  id: ArtifactId;
  type: ArtifactType;
  name: string;
  description: string;
  
  // Content
  filePath?: string;
  content?: string;
  data?: unknown;
  
  // Metadata
  mimeType?: string;
  size?: number;
  checksum?: string;
  
  // Provenance
  createdBy: AutonomousAgentId;
  missionId: MissionId;
  phaseId: string;
  
  // Quality
  validated: boolean;
  quality?: number; // 0-1
  
  createdAt: number;
}

export interface KnowledgeBase {
  // Learned patterns and insights
  patterns: LearnedPattern[];
  
  // Skills and techniques
  skills: LearnedSkill[];
  
  // Facts and data
  facts: LearnedFact[];
  
  // Error recovery strategies
  errorRecoveries: ErrorRecovery[];
  
  // Optimization strategies
  optimizations: OptimizationStrategy[];
  
  // Statistics
  totalEntries: number;
  lastUpdated: number;
}

export interface LearnedPattern {
  id: string;
  type: string;
  description: string;
  pattern: string;
  examples: string[];
  confidence: number;
  usageCount: number;
  successRate: number;
  createdAt: number;
}

export interface LearnedSkill {
  id: string;
  name: string;
  description: string;
  steps: string[];
  proficiency: number;
  practicedCount: number;
  lastUsed?: number;
}

export interface LearnedFact {
  id: string;
  category: string;
  fact: string;
  source: string;
  confidence: number;
  createdAt: number;
}

export interface ErrorRecovery {
  id: string;
  errorType: string;
  errorPattern: string;
  recoveryStrategy: string;
  successRate: number;
  usageCount: number;
}

export interface OptimizationStrategy {
  id: string;
  target: string;
  strategy: string;
  improvement: number;
  applicableWhen: string[];
}

export interface LearningRecord {
  id: LearningId;
  type: "pattern" | "skill" | "fact" | "error_recovery" | "optimization";
  content: unknown;
  source: "observation" | "experiment" | "feedback" | "inheritance";
  confidence: number;
  createdAt: number;
}

export interface EvolutionRecord {
  id: EvolutionId;
  type: "capability_added" | "capability_improved" | "config_changed" | "knowledge_gained" | "replicated";
  description: string;
  changes: Record<string, { before: unknown; after: unknown }>;
  reason: string;
  success: boolean;
  createdAt: number;
}

export interface AgentPerformanceMetrics {
  // Mission metrics
  totalMissions: number;
  successfulMissions: number;
  failedMissions: number;
  averageMissionDuration: number;
  
  // Action metrics
  totalActions: number;
  successfulActions: number;
  actionsPerHour: number;
  
  // Resource usage
  totalTokensUsed: number;
  tokensPerMission: number;
  memoryUsageMb: number;
  storageUsedMb: number;
  
  // Learning metrics
  knowledgeEntries: number;
  skillsLearned: number;
  patternsDiscovered: number;
  
  // Evolution metrics
  evolutions: number;
  replications: number;
  generation: number;
  
  // Voice metrics
  transcriptionsProcessed: number;
  speechSynthesized: number;
  voiceCommandsHandled: number;
  
  // Uptime
  totalUptime: number;
  currentSessionDuration: number;
  lastActive: number;
}

// =============================================================================
// EVENT TYPES
// =============================================================================

export type AutonomousAgentEventType =
  | "agent:created"
  | "agent:activated"
  | "agent:state_changed"
  | "agent:capability_added"
  | "agent:capability_improved"
  | "mission:created"
  | "mission:started"
  | "mission:phase_started"
  | "mission:phase_completed"
  | "mission:completed"
  | "mission:failed"
  | "action:started"
  | "action:completed"
  | "action:failed"
  | "artifact:created"
  | "knowledge:learned"
  | "evolution:started"
  | "evolution:completed"
  | "replication:started"
  | "replication:completed"
  | "voice:transcribed"
  | "voice:synthesized"
  | "error:occurred"
  | "resource:warning";

export interface AutonomousAgentEvent {
  type: AutonomousAgentEventType;
  agentId: AutonomousAgentId;
  missionId?: MissionId;
  timestamp: number;
  data: Record<string, unknown>;
}

// =============================================================================
// AUTONOMOUS AGENT SYSTEM
// =============================================================================

export class AutonomousAgentSystem extends EventEmitter {
  private static instance: AutonomousAgentSystem;
  
  private db: Database.Database | null = null;
  private agents: Map<AutonomousAgentId, AutonomousAgent> = new Map();
  private missions: Map<MissionId, Mission> = new Map();
  private artifacts: Map<ArtifactId, Artifact> = new Map();
  private activeProcesses: Map<string, ChildProcess> = new Map();
  private initialized = false;
  
  private dataDir: string;
  private modelsDir: string;
  private voiceDir: string;
  private artifactsDir: string;
  private codeDir: string;
  
  private constructor() {
    super();
    const userDataPath = app.getPath("userData");
    this.dataDir = path.join(userDataPath, "autonomous_agents");
    this.modelsDir = path.join(this.dataDir, "models");
    this.voiceDir = path.join(this.dataDir, "voice");
    this.artifactsDir = path.join(this.dataDir, "artifacts");
    this.codeDir = path.join(this.dataDir, "generated_code");
  }
  
  static getInstance(): AutonomousAgentSystem {
    if (!AutonomousAgentSystem.instance) {
      AutonomousAgentSystem.instance = new AutonomousAgentSystem();
    }
    return AutonomousAgentSystem.instance;
  }
  
  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================
  
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    // Create directories
    await fs.mkdir(this.dataDir, { recursive: true });
    await fs.mkdir(this.modelsDir, { recursive: true });
    await fs.mkdir(this.voiceDir, { recursive: true });
    await fs.mkdir(this.artifactsDir, { recursive: true });
    await fs.mkdir(this.codeDir, { recursive: true });
    
    // Initialize database
    const dbPath = path.join(this.dataDir, "autonomous_agents.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    
    this.createTables();
    this.loadExistingData();
    
    this.initialized = true;
    this.emit("initialized");
  }
  
  private createTables(): void {
    if (!this.db) throw new Error("Database not initialized");
    
    // Agents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS autonomous_agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        purpose TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'dormant',
        generation INTEGER NOT NULL DEFAULT 0,
        parent_id TEXT,
        child_ids TEXT DEFAULT '[]',
        config TEXT NOT NULL,
        capabilities TEXT DEFAULT '[]',
        current_mission TEXT,
        mission_queue TEXT DEFAULT '[]',
        knowledge TEXT DEFAULT '{}',
        evolution_history TEXT DEFAULT '[]',
        metrics TEXT DEFAULT '{}',
        created_at INTEGER NOT NULL,
        activated_at INTEGER,
        last_active_at INTEGER,
        terminated_at INTEGER,
        FOREIGN KEY (parent_id) REFERENCES autonomous_agents(id)
      )
    `);
    
    // Missions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS autonomous_missions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        objective TEXT NOT NULL,
        context TEXT,
        constraints TEXT DEFAULT '[]',
        success_criteria TEXT DEFAULT '[]',
        plan TEXT,
        current_phase INTEGER DEFAULT 0,
        phases TEXT DEFAULT '[]',
        artifacts TEXT DEFAULT '[]',
        learnings TEXT DEFAULT '[]',
        started_at INTEGER,
        completed_at INTEGER,
        tokens_used INTEGER DEFAULT 0,
        actions_performed INTEGER DEFAULT 0,
        errors_encountered INTEGER DEFAULT 0,
        parent_mission_id TEXT,
        sub_mission_ids TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES autonomous_agents(id),
        FOREIGN KEY (parent_mission_id) REFERENCES autonomous_missions(id)
      )
    `);
    
    // Artifacts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS autonomous_artifacts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        file_path TEXT,
        content TEXT,
        data TEXT,
        mime_type TEXT,
        size INTEGER,
        checksum TEXT,
        created_by TEXT NOT NULL,
        mission_id TEXT NOT NULL,
        phase_id TEXT,
        validated INTEGER DEFAULT 0,
        quality REAL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (created_by) REFERENCES autonomous_agents(id),
        FOREIGN KEY (mission_id) REFERENCES autonomous_missions(id)
      )
    `);
    
    // Agent events table for history
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS autonomous_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        mission_id TEXT,
        timestamp INTEGER NOT NULL,
        data TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES autonomous_agents(id)
      )
    `);
    
    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_missions_agent ON autonomous_missions(agent_id);
      CREATE INDEX IF NOT EXISTS idx_missions_status ON autonomous_missions(status);
      CREATE INDEX IF NOT EXISTS idx_artifacts_mission ON autonomous_artifacts(mission_id);
      CREATE INDEX IF NOT EXISTS idx_events_agent ON autonomous_events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON autonomous_events(type);
    `);
    
    // FTS for knowledge search
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS autonomous_knowledge_fts USING fts5(
        agent_id,
        category,
        content,
        source,
        tokenize='porter'
      )
    `);
  }
  
  private loadExistingData(): void {
    if (!this.db) return;
    
    // Load agents
    const agents = this.db.prepare("SELECT * FROM autonomous_agents").all() as any[];
    for (const row of agents) {
      const agent = this.rowToAgent(row);
      this.agents.set(agent.id, agent);
    }
    
    // Load active missions
    const missions = this.db.prepare(
      "SELECT * FROM autonomous_missions WHERE status IN ('pending', 'planning', 'executing', 'validating')"
    ).all() as any[];
    for (const row of missions) {
      const mission = this.rowToMission(row);
      this.missions.set(mission.id, mission);
    }
  }
  
  private rowToAgent(row: any): AutonomousAgent {
    return {
      id: row.id as AutonomousAgentId,
      name: row.name,
      purpose: row.purpose,
      state: row.state,
      generation: row.generation,
      parentId: row.parent_id as AutonomousAgentId | null,
      childIds: JSON.parse(row.child_ids || "[]"),
      config: JSON.parse(row.config),
      capabilities: JSON.parse(row.capabilities || "[]"),
      currentMission: row.current_mission as MissionId | null,
      missionQueue: JSON.parse(row.mission_queue || "[]"),
      knowledge: JSON.parse(row.knowledge || "{}"),
      evolutionHistory: JSON.parse(row.evolution_history || "[]"),
      metrics: JSON.parse(row.metrics || "{}"),
      createdAt: row.created_at,
      activatedAt: row.activated_at,
      lastActiveAt: row.last_active_at,
      terminatedAt: row.terminated_at,
    };
  }
  
  private rowToMission(row: any): Mission {
    return {
      id: row.id as MissionId,
      agentId: row.agent_id as AutonomousAgentId,
      type: row.type,
      status: row.status,
      objective: row.objective,
      context: row.context || "",
      constraints: JSON.parse(row.constraints || "[]"),
      successCriteria: JSON.parse(row.success_criteria || "[]"),
      plan: row.plan ? JSON.parse(row.plan) : null,
      currentPhase: row.current_phase,
      phases: JSON.parse(row.phases || "[]"),
      artifacts: JSON.parse(row.artifacts || "[]"),
      learnings: JSON.parse(row.learnings || "[]"),
      startedAt: row.started_at,
      completedAt: row.completed_at,
      tokensUsed: row.tokens_used,
      actionsPerformed: row.actions_performed,
      errorsEncountered: row.errors_encountered,
      parentMissionId: row.parent_mission_id as MissionId | undefined,
      subMissionIds: JSON.parse(row.sub_mission_ids || "[]"),
      createdAt: row.created_at,
    };
  }
  
  // ===========================================================================
  // AGENT MANAGEMENT
  // ===========================================================================
  
  async createAgent(params: {
    name: string;
    purpose: string;
    config?: Partial<AgentConfiguration>;
    parentId?: AutonomousAgentId;
  }): Promise<AutonomousAgent> {
    if (!this.db) throw new Error("Not initialized");
    
    const id = randomUUID() as AutonomousAgentId;
    const now = Date.now();
    
    // Get parent info for generation
    let generation = 0;
    if (params.parentId) {
      const parent = this.agents.get(params.parentId);
      if (parent) {
        generation = parent.generation + 1;
      }
    }
    
    const defaultConfig: AgentConfiguration = {
      primaryModel: "gpt-5-mini",
      fallbackModels: ["gemini-3-flash-preview", "claude-sonnet-4-5"],
      temperature: 0.7,
      maxTokens: 4096,
      autonomyLevel: "semi-autonomous",
      requiresApproval: ["replicate", "install_dependency", "delete_file"],
      maxActionsPerHour: 100,
      maxMemoryMb: 512,
      maxCpuPercent: 50,
      maxStorageMb: 1024,
      canEvolve: true,
      canReplicate: true,
      maxGenerations: 5,
      mutationRate: 0.1,
      voiceEnabled: true,
      voiceModel: "piper",
      voiceLanguage: "en-US",
      learningEnabled: true,
      learningRate: 0.1,
      knowledgeRetention: 0.9,
    };
    
    const config = { ...defaultConfig, ...params.config };
    
    const agent: AutonomousAgent = {
      id,
      name: params.name,
      purpose: params.purpose,
      state: "dormant",
      generation,
      parentId: params.parentId || null,
      childIds: [],
      config,
      capabilities: this.getDefaultCapabilities(),
      currentMission: null,
      missionQueue: [],
      knowledge: {
        patterns: [],
        skills: [],
        facts: [],
        errorRecoveries: [],
        optimizations: [],
        totalEntries: 0,
        lastUpdated: now,
      },
      evolutionHistory: [],
      metrics: this.getDefaultMetrics(),
      createdAt: now,
    };
    
    // Save to database
    this.db.prepare(`
      INSERT INTO autonomous_agents (
        id, name, purpose, state, generation, parent_id, child_ids,
        config, capabilities, current_mission, mission_queue, knowledge,
        evolution_history, metrics, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      agent.name,
      agent.purpose,
      agent.state,
      agent.generation,
      agent.parentId,
      JSON.stringify(agent.childIds),
      JSON.stringify(agent.config),
      JSON.stringify(agent.capabilities),
      agent.currentMission,
      JSON.stringify(agent.missionQueue),
      JSON.stringify(agent.knowledge),
      JSON.stringify(agent.evolutionHistory),
      JSON.stringify(agent.metrics),
      agent.createdAt
    );
    
    // Update parent's child list
    if (params.parentId) {
      const parent = this.agents.get(params.parentId);
      if (parent) {
        parent.childIds.push(id);
        this.updateAgent(parent);
      }
    }
    
    this.agents.set(id, agent);
    this.emitEvent("agent:created", id, { agent });
    
    return agent;
  }
  
  private getDefaultCapabilities(): AgentCapability[] {
    const capabilities: AgentCapability[] = [
      {
        id: randomUUID() as CapabilityId,
        type: "scraping",
        name: "Web Scraping",
        description: "Extract data from websites",
        proficiency: 0.5,
        enabled: true,
        requires: [],
        resources: { toolsRequired: ["puppeteer", "cheerio"], memoryMb: 256, timeoutMs: 60000 },
        usageCount: 0,
        successRate: 0,
      },
      {
        id: randomUUID() as CapabilityId,
        type: "code_generation",
        name: "Code Generation",
        description: "Generate source code",
        proficiency: 0.7,
        enabled: true,
        requires: [],
        resources: { modelRequired: "gpt-5-mini", toolsRequired: [], memoryMb: 128, timeoutMs: 120000 },
        usageCount: 0,
        successRate: 0,
      },
      {
        id: randomUUID() as CapabilityId,
        type: "ui_generation",
        name: "UI Generation",
        description: "Create user interface components",
        proficiency: 0.6,
        enabled: true,
        requires: [],
        resources: { modelRequired: "gpt-5-mini", toolsRequired: ["react", "tailwindcss"], memoryMb: 256, timeoutMs: 180000 },
        usageCount: 0,
        successRate: 0,
      },
      {
        id: randomUUID() as CapabilityId,
        type: "voice_input",
        name: "Voice Input (Whisper)",
        description: "Transcribe speech to text",
        proficiency: 0.8,
        enabled: true,
        requires: [],
        resources: { modelRequired: "whisper", toolsRequired: ["whisper"], memoryMb: 512, timeoutMs: 30000 },
        usageCount: 0,
        successRate: 0,
      },
      {
        id: randomUUID() as CapabilityId,
        type: "voice_output",
        name: "Voice Output (Piper)",
        description: "Synthesize speech from text",
        proficiency: 0.8,
        enabled: true,
        requires: [],
        resources: { modelRequired: "piper", toolsRequired: ["piper"], memoryMb: 256, timeoutMs: 10000 },
        usageCount: 0,
        successRate: 0,
      },
      {
        id: randomUUID() as CapabilityId,
        type: "model_usage",
        name: "AI Model Inference",
        description: "Use AI models for reasoning",
        proficiency: 0.9,
        enabled: true,
        requires: [],
        resources: { toolsRequired: [], memoryMb: 512, timeoutMs: 60000 },
        usageCount: 0,
        successRate: 0,
      },
      {
        id: randomUUID() as CapabilityId,
        type: "data_analysis",
        name: "Data Analysis",
        description: "Analyze and process data",
        proficiency: 0.7,
        enabled: true,
        requires: [],
        resources: { toolsRequired: ["pandas", "numpy"], memoryMb: 256, timeoutMs: 120000 },
        usageCount: 0,
        successRate: 0,
      },
      {
        id: randomUUID() as CapabilityId,
        type: "file_operations",
        name: "File Operations",
        description: "Read, write, and manage files",
        proficiency: 0.95,
        enabled: true,
        requires: [],
        resources: { toolsRequired: [], memoryMb: 64, timeoutMs: 30000 },
        usageCount: 0,
        successRate: 0,
      },
      {
        id: randomUUID() as CapabilityId,
        type: "terminal",
        name: "Terminal Commands",
        description: "Execute shell commands",
        proficiency: 0.8,
        enabled: true,
        requires: [],
        resources: { toolsRequired: [], memoryMb: 128, timeoutMs: 300000 },
        usageCount: 0,
        successRate: 0,
      },
      {
        id: randomUUID() as CapabilityId,
        type: "web_browsing",
        name: "Web Browsing",
        description: "Browse and interact with websites",
        proficiency: 0.6,
        enabled: true,
        requires: [],
        resources: { toolsRequired: ["puppeteer"], memoryMb: 512, timeoutMs: 120000 },
        usageCount: 0,
        successRate: 0,
      },
      {
        id: randomUUID() as CapabilityId,
        type: "learning",
        name: "Self-Learning",
        description: "Learn from experience and improve",
        proficiency: 0.5,
        enabled: true,
        requires: [],
        resources: { toolsRequired: [], memoryMb: 128, timeoutMs: 60000 },
        usageCount: 0,
        successRate: 0,
      },
      {
        id: randomUUID() as CapabilityId,
        type: "replication",
        name: "Self-Replication",
        description: "Create copies of self",
        proficiency: 0.7,
        enabled: true,
        requires: [],
        resources: { toolsRequired: [], memoryMb: 256, timeoutMs: 60000 },
        usageCount: 0,
        successRate: 0,
      },
    ];
    
    return capabilities;
  }
  
  private getDefaultMetrics(): AgentPerformanceMetrics {
    return {
      totalMissions: 0,
      successfulMissions: 0,
      failedMissions: 0,
      averageMissionDuration: 0,
      totalActions: 0,
      successfulActions: 0,
      actionsPerHour: 0,
      totalTokensUsed: 0,
      tokensPerMission: 0,
      memoryUsageMb: 0,
      storageUsedMb: 0,
      knowledgeEntries: 0,
      skillsLearned: 0,
      patternsDiscovered: 0,
      evolutions: 0,
      replications: 0,
      generation: 0,
      transcriptionsProcessed: 0,
      speechSynthesized: 0,
      voiceCommandsHandled: 0,
      totalUptime: 0,
      currentSessionDuration: 0,
      lastActive: Date.now(),
    };
  }
  
  async activateAgent(agentId: AutonomousAgentId): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");
    
    if (agent.state !== "dormant" && agent.state !== "hibernating") {
      throw new Error(`Cannot activate agent in state: ${agent.state}`);
    }
    
    agent.state = "initializing";
    agent.activatedAt = Date.now();
    this.updateAgent(agent);
    this.emitEvent("agent:activated", agentId, { previousState: "dormant" });
    
    // Initialize capabilities
    await this.initializeCapabilities(agent);
    
    agent.state = "active";
    agent.lastActiveAt = Date.now();
    this.updateAgent(agent);
    this.emitEvent("agent:state_changed", agentId, { state: "active" });
    
    // Start autonomous loop
    this.runAutonomousLoop(agent);
  }
  
  private async initializeCapabilities(agent: AutonomousAgent): Promise<void> {
    // Check and install required tools
    for (const capability of agent.capabilities) {
      if (!capability.enabled) continue;
      
      for (const tool of capability.resources.toolsRequired) {
        await this.ensureToolAvailable(tool);
      }
    }
    
    // Setup voice if enabled
    if (agent.config.voiceEnabled) {
      await this.setupVoice(agent);
    }
  }
  
  private async ensureToolAvailable(tool: string): Promise<boolean> {
    // Check if tool is available
    const toolChecks: Record<string, () => Promise<boolean>> = {
      puppeteer: async () => this.checkNodeModule("puppeteer"),
      cheerio: async () => this.checkNodeModule("cheerio"),
      whisper: async () => this.checkWhisperAvailable(),
      piper: async () => this.checkPiperAvailable(),
    };
    
    const check = toolChecks[tool];
    if (check) {
      return await check();
    }
    return true;
  }
  
  private async checkNodeModule(moduleName: string): Promise<boolean> {
    try {
      require.resolve(moduleName);
      return true;
    } catch {
      return false;
    }
  }
  
  private async checkWhisperAvailable(): Promise<boolean> {
    const whisperPath = path.join(this.voiceDir, "whisper");
    return existsSync(whisperPath);
  }
  
  private async checkPiperAvailable(): Promise<boolean> {
    const piperPath = path.join(this.voiceDir, "piper");
    return existsSync(piperPath);
  }
  
  private async setupVoice(agent: AutonomousAgent): Promise<void> {
    // Download and setup voice models if needed
    if (agent.config.voiceModel === "whisper" || agent.config.voiceModel === "both") {
      await this.downloadWhisperModel();
    }
    if (agent.config.voiceModel === "piper" || agent.config.voiceModel === "both") {
      await this.downloadPiperModel();
    }
  }
  
  private async downloadWhisperModel(): Promise<void> {
    const modelPath = path.join(this.voiceDir, "whisper", "base.bin");
    if (existsSync(modelPath)) return;
    
    await fs.mkdir(path.dirname(modelPath), { recursive: true });
    
    // Download whisper model
    const modelUrl = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
    await this.downloadFile(modelUrl, modelPath);
  }
  
  private async downloadPiperModel(): Promise<void> {
    const modelPath = path.join(this.voiceDir, "piper", "en_US-lessac-medium.onnx");
    if (existsSync(modelPath)) return;
    
    await fs.mkdir(path.dirname(modelPath), { recursive: true });
    
    // Download piper model
    const modelUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx";
    await this.downloadFile(modelUrl, modelPath);
  }
  
  private async downloadFile(url: string, destPath: string): Promise<void> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download: ${url}`);
    
    const buffer = await response.arrayBuffer();
    await fs.writeFile(destPath, Buffer.from(buffer));
  }
  
  private updateAgent(agent: AutonomousAgent): void {
    if (!this.db) return;
    
    this.db.prepare(`
      UPDATE autonomous_agents SET
        name = ?, purpose = ?, state = ?, generation = ?,
        parent_id = ?, child_ids = ?, config = ?, capabilities = ?,
        current_mission = ?, mission_queue = ?, knowledge = ?,
        evolution_history = ?, metrics = ?, activated_at = ?,
        last_active_at = ?, terminated_at = ?
      WHERE id = ?
    `).run(
      agent.name,
      agent.purpose,
      agent.state,
      agent.generation,
      agent.parentId,
      JSON.stringify(agent.childIds),
      JSON.stringify(agent.config),
      JSON.stringify(agent.capabilities),
      agent.currentMission,
      JSON.stringify(agent.missionQueue),
      JSON.stringify(agent.knowledge),
      JSON.stringify(agent.evolutionHistory),
      JSON.stringify(agent.metrics),
      agent.activatedAt,
      agent.lastActiveAt,
      agent.terminatedAt,
      agent.id
    );
    
    this.agents.set(agent.id, agent);
  }
  
  // ===========================================================================
  // AUTONOMOUS LOOP
  // ===========================================================================
  
  private async runAutonomousLoop(agent: AutonomousAgent): Promise<void> {
    while (agent.state === "active") {
      try {
        // Check for pending missions
        if (agent.currentMission) {
          await this.executeMission(agent, agent.currentMission);
        } else if (agent.missionQueue.length > 0) {
          const nextMission = agent.missionQueue.shift()!;
          agent.currentMission = nextMission;
          this.updateAgent(agent);
          await this.executeMission(agent, nextMission);
        } else {
          // No missions - check if we should evolve or replicate
          await this.considerEvolution(agent);
          
          // Idle time - learn from past experiences
          await this.performIdleLearning(agent);
        }
        
        // Update last active
        agent.lastActiveAt = Date.now();
        this.updateAgent(agent);
        
        // Small delay to prevent tight loop
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Refresh agent state
        const refreshedAgent = this.agents.get(agent.id);
        if (!refreshedAgent || refreshedAgent.state !== "active") break;
        agent = refreshedAgent;
        
      } catch (error) {
        this.emitEvent("error:occurred", agent.id, { 
          error: error instanceof Error ? error.message : String(error) 
        });
        
        // Try to recover
        await this.attemptErrorRecovery(agent, error);
      }
    }
  }
  
  private async considerEvolution(agent: AutonomousAgent): Promise<void> {
    if (!agent.config.canEvolve) return;
    
    // Check if evolution is warranted based on metrics
    const shouldEvolve = this.shouldAgentEvolve(agent);
    if (shouldEvolve) {
      agent.state = "evolving";
      this.updateAgent(agent);
      await this.evolveAgent(agent);
      agent.state = "active";
      this.updateAgent(agent);
    }
    
    // Check if replication is warranted
    if (agent.config.canReplicate) {
      const shouldReplicate = this.shouldAgentReplicate(agent);
      if (shouldReplicate) {
        agent.state = "replicating";
        this.updateAgent(agent);
        await this.replicateAgent(agent);
        agent.state = "active";
        this.updateAgent(agent);
      }
    }
  }
  
  private shouldAgentEvolve(agent: AutonomousAgent): boolean {
    // Evolve if:
    // 1. Success rate is below threshold
    // 2. A capability has low proficiency but high usage
    // 3. Enough missions completed to have meaningful data
    
    if (agent.metrics.totalMissions < 10) return false;
    
    const successRate = agent.metrics.successfulMissions / agent.metrics.totalMissions;
    if (successRate < 0.7) return true;
    
    for (const cap of agent.capabilities) {
      if (cap.usageCount > 10 && cap.proficiency < 0.5) return true;
    }
    
    return false;
  }
  
  private shouldAgentReplicate(agent: AutonomousAgent): boolean {
    // Replicate if:
    // 1. Mission queue is too long
    // 2. Agent has high success rate
    // 3. Haven't reached max children
    
    if (agent.generation >= agent.config.maxGenerations) return false;
    if (agent.childIds.length >= 5) return false; // Max 5 children
    if (agent.missionQueue.length < 5) return false;
    
    const successRate = agent.metrics.successfulMissions / Math.max(agent.metrics.totalMissions, 1);
    return successRate > 0.8;
  }
  
  private async evolveAgent(agent: AutonomousAgent): Promise<void> {
    this.emitEvent("evolution:started", agent.id, {});
    
    const evolution: EvolutionRecord = {
      id: randomUUID() as EvolutionId,
      type: "capability_improved",
      description: "Automated evolution based on performance analysis",
      changes: {},
      reason: "Performance optimization",
      success: false,
      createdAt: Date.now(),
    };
    
    // Analyze performance and improve weak areas
    for (const cap of agent.capabilities) {
      if (cap.usageCount > 5 && cap.successRate < 0.7) {
        const oldProficiency = cap.proficiency;
        cap.proficiency = Math.min(1, cap.proficiency + agent.config.learningRate);
        evolution.changes[cap.id] = {
          before: { proficiency: oldProficiency },
          after: { proficiency: cap.proficiency },
        };
      }
    }
    
    evolution.success = true;
    agent.evolutionHistory.push(evolution);
    agent.metrics.evolutions++;
    this.updateAgent(agent);
    
    this.emitEvent("evolution:completed", agent.id, { evolution });
  }
  
  async replicateAgent(agent: AutonomousAgent, specialization?: string): Promise<AutonomousAgent> {
    this.emitEvent("replication:started", agent.id, { specialization });
    
    // Create offspring with inherited traits
    const offspring = await this.createAgent({
      name: `${agent.name}-child-${agent.childIds.length + 1}`,
      purpose: specialization || agent.purpose,
      config: {
        ...agent.config,
        // Slight mutation
        temperature: Math.max(0, Math.min(1, agent.config.temperature + (Math.random() - 0.5) * agent.config.mutationRate)),
        learningRate: Math.max(0.01, Math.min(0.5, agent.config.learningRate + (Math.random() - 0.5) * 0.1)),
      },
      parentId: agent.id,
    });
    
    // Transfer knowledge
    offspring.knowledge = JSON.parse(JSON.stringify(agent.knowledge));
    offspring.knowledge.lastUpdated = Date.now();
    
    // Inherit capabilities with slight variations
    offspring.capabilities = agent.capabilities.map(cap => ({
      ...cap,
      id: randomUUID() as CapabilityId,
      proficiency: Math.max(0, Math.min(1, cap.proficiency * (0.9 + Math.random() * 0.2))),
      usageCount: 0,
      successRate: 0,
      learnedFrom: agent.id,
    }));
    
    this.updateAgent(offspring);
    
    agent.childIds.push(offspring.id);
    agent.metrics.replications++;
    this.updateAgent(agent);
    
    this.emitEvent("replication:completed", agent.id, { offspringId: offspring.id });
    
    return offspring;
  }
  
  private async performIdleLearning(agent: AutonomousAgent): Promise<void> {
    // Review past missions and extract patterns
    if (!this.db) return;
    
    const recentMissions = this.db.prepare(`
      SELECT * FROM autonomous_missions 
      WHERE agent_id = ? AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 10
    `).all(agent.id) as any[];
    
    for (const missionRow of recentMissions) {
      const learnings = JSON.parse(missionRow.learnings || "[]");
      for (const learning of learnings) {
        this.integrateKnowledge(agent, learning);
      }
    }
    
    agent.knowledge.lastUpdated = Date.now();
    this.updateAgent(agent);
  }
  
  private integrateKnowledge(agent: AutonomousAgent, learning: LearningRecord): void {
    switch (learning.type) {
      case "pattern":
        const pattern = learning.content as LearnedPattern;
        const existingPattern = agent.knowledge.patterns.find(p => p.pattern === pattern.pattern);
        if (existingPattern) {
          existingPattern.confidence = Math.min(1, existingPattern.confidence + 0.1);
          existingPattern.usageCount++;
        } else {
          agent.knowledge.patterns.push(pattern);
        }
        break;
        
      case "skill":
        const skill = learning.content as LearnedSkill;
        const existingSkill = agent.knowledge.skills.find(s => s.name === skill.name);
        if (existingSkill) {
          existingSkill.proficiency = Math.min(1, existingSkill.proficiency + 0.1);
          existingSkill.practicedCount++;
        } else {
          agent.knowledge.skills.push(skill);
        }
        break;
        
      case "error_recovery":
        const recovery = learning.content as ErrorRecovery;
        const existingRecovery = agent.knowledge.errorRecoveries.find(
          r => r.errorType === recovery.errorType
        );
        if (existingRecovery) {
          existingRecovery.usageCount++;
          existingRecovery.successRate = 
            (existingRecovery.successRate * (existingRecovery.usageCount - 1) + 
            (recovery.successRate > 0.5 ? 1 : 0)) / existingRecovery.usageCount;
        } else {
          agent.knowledge.errorRecoveries.push(recovery);
        }
        break;
    }
    
    agent.knowledge.totalEntries++;
    agent.metrics.knowledgeEntries = agent.knowledge.totalEntries;
  }
  
  private async attemptErrorRecovery(agent: AutonomousAgent, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Look for matching error recovery strategy
    const recovery = agent.knowledge.errorRecoveries.find(r => 
      errorMessage.toLowerCase().includes(r.errorPattern.toLowerCase())
    );
    
    if (recovery) {
      // Apply recovery strategy
      this.emitEvent("error:occurred", agent.id, {
        error: errorMessage,
        recoveryStrategy: recovery.recoveryStrategy,
      });
      
      // Execute recovery...
      recovery.usageCount++;
      this.updateAgent(agent);
    } else {
      // Learn from this new error
      const newRecovery: ErrorRecovery = {
        id: randomUUID(),
        errorType: error instanceof Error ? error.constructor.name : "UnknownError",
        errorPattern: errorMessage.substring(0, 100),
        recoveryStrategy: "Retry with modified parameters",
        successRate: 0,
        usageCount: 1,
      };
      
      agent.knowledge.errorRecoveries.push(newRecovery);
      this.updateAgent(agent);
    }
  }
  
  // ===========================================================================
  // MISSION EXECUTION
  // ===========================================================================
  
  async createMission(params: {
    agentId: AutonomousAgentId;
    type: MissionType;
    objective: string;
    context?: string;
    constraints?: string[];
    successCriteria?: string[];
  }): Promise<Mission> {
    if (!this.db) throw new Error("Not initialized");
    
    const id = randomUUID() as MissionId;
    const now = Date.now();
    
    const mission: Mission = {
      id,
      agentId: params.agentId,
      type: params.type,
      status: "pending",
      objective: params.objective,
      context: params.context || "",
      constraints: params.constraints || [],
      successCriteria: params.successCriteria || [],
      plan: null,
      currentPhase: 0,
      phases: [],
      artifacts: [],
      learnings: [],
      tokensUsed: 0,
      actionsPerformed: 0,
      errorsEncountered: 0,
      subMissionIds: [],
      createdAt: now,
    };
    
    this.db.prepare(`
      INSERT INTO autonomous_missions (
        id, agent_id, type, status, objective, context, constraints,
        success_criteria, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      params.agentId,
      params.type,
      mission.status,
      mission.objective,
      mission.context,
      JSON.stringify(mission.constraints),
      JSON.stringify(mission.successCriteria),
      now
    );
    
    this.missions.set(id, mission);
    
    // Add to agent's queue
    const agent = this.agents.get(params.agentId);
    if (agent) {
      agent.missionQueue.push(id);
      this.updateAgent(agent);
    }
    
    this.emitEvent("mission:created", params.agentId, { missionId: id, objective: params.objective });
    
    return mission;
  }
  
  private async executeMission(agent: AutonomousAgent, missionId: MissionId): Promise<void> {
    const mission = this.missions.get(missionId);
    if (!mission) throw new Error("Mission not found");
    
    try {
      // Planning phase
      mission.status = "planning";
      this.updateMission(mission);
      this.emitEvent("mission:started", agent.id, { missionId });
      
      mission.plan = await this.planMission(agent, mission);
      mission.phases = mission.plan.phases;
      
      // Execution phase
      mission.status = "executing";
      mission.startedAt = Date.now();
      this.updateMission(mission);
      
      for (let i = 0; i < mission.phases.length; i++) {
        mission.currentPhase = i;
        const phase = mission.phases[i];
        
        // Check dependencies
        const canStart = phase.dependsOn.every(depId => {
          const depPhase = mission.phases.find(p => p.id === depId);
          return depPhase?.status === "completed";
        });
        
        if (!canStart) {
          phase.status = "skipped";
          continue;
        }
        
        this.emitEvent("mission:phase_started", agent.id, { missionId, phaseId: phase.id, phaseName: phase.name });
        
        phase.status = "running";
        phase.startedAt = Date.now();
        this.updateMission(mission);
        
        try {
          await this.executePhase(agent, mission, phase);
          phase.status = "completed";
          phase.completedAt = Date.now();
        } catch (error) {
          phase.status = "failed";
          phase.error = error instanceof Error ? error.message : String(error);
          mission.errorsEncountered++;
          
          // Try to continue with other phases if possible
          if (this.isCriticalPhase(phase)) {
            throw error;
          }
        }
        
        this.updateMission(mission);
        this.emitEvent("mission:phase_completed", agent.id, { 
          missionId, 
          phaseId: phase.id, 
          success: phase.status === "completed" 
        });
      }
      
      // Validation phase
      mission.status = "validating";
      this.updateMission(mission);
      
      const valid = await this.validateMission(agent, mission);
      
      if (valid) {
        mission.status = "completed";
        agent.metrics.successfulMissions++;
      } else {
        mission.status = "failed";
        agent.metrics.failedMissions++;
      }
      
      mission.completedAt = Date.now();
      agent.metrics.totalMissions++;
      agent.currentMission = null;
      
    } catch (error) {
      mission.status = "failed";
      mission.completedAt = Date.now();
      agent.metrics.failedMissions++;
      agent.metrics.totalMissions++;
      agent.currentMission = null;
      
      // Learn from failure
      const learning: LearningRecord = {
        id: randomUUID() as LearningId,
        type: "error_recovery",
        content: {
          id: randomUUID(),
          errorType: error instanceof Error ? error.constructor.name : "UnknownError",
          errorPattern: (error instanceof Error ? error.message : String(error)).substring(0, 100),
          recoveryStrategy: "To be determined",
          successRate: 0,
          usageCount: 1,
        },
        source: "observation",
        confidence: 0.5,
        createdAt: Date.now(),
      };
      mission.learnings.push(learning);
      
      this.emitEvent("mission:failed", agent.id, { 
        missionId, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
    
    this.updateMission(mission);
    this.updateAgent(agent);
    
    if (mission.status === "completed") {
      this.emitEvent("mission:completed", agent.id, { missionId, artifacts: mission.artifacts });
    }
  }
  
  private async planMission(agent: AutonomousAgent, mission: Mission): Promise<MissionPlan> {
    // Use AI to create a detailed plan
    const phases: MissionPhase[] = [];
    
    // Determine required phases based on mission type
    switch (mission.type) {
      case "research":
        phases.push(
          this.createPhase("research", "Web Research", "Gather information from the web"),
          this.createPhase("data_acquisition", "Data Collection", "Extract and store relevant data"),
          this.createPhase("analysis", "Analysis", "Analyze collected data"),
        );
        break;
        
      case "build":
        phases.push(
          this.createPhase("planning", "Architecture Planning", "Design the solution architecture"),
          this.createPhase("code_generation", "Code Generation", "Generate source code"),
          this.createPhase("ui_generation", "UI Generation", "Create user interface"),
          this.createPhase("testing", "Testing", "Test the implementation"),
          this.createPhase("deployment", "Deployment", "Deploy the solution"),
        );
        break;
        
      case "integrate":
        phases.push(
          this.createPhase("research", "System Analysis", "Analyze systems to integrate"),
          this.createPhase("planning", "Integration Planning", "Plan integration approach"),
          this.createPhase("code_generation", "Integration Code", "Create integration code"),
          this.createPhase("testing", "Integration Testing", "Test the integration"),
        );
        break;
        
      case "evolve":
        phases.push(
          this.createPhase("analysis", "Self Analysis", "Analyze current capabilities"),
          this.createPhase("planning", "Evolution Planning", "Plan improvements"),
          this.createPhase("learning", "Learning", "Acquire new knowledge"),
          this.createPhase("validation", "Validation", "Validate improvements"),
        );
        break;
        
      case "replicate":
        phases.push(
          this.createPhase("analysis", "Self Analysis", "Analyze traits to replicate"),
          this.createPhase("planning", "Replication Planning", "Plan offspring characteristics"),
          this.createPhase("code_generation", "Offspring Creation", "Create new agent"),
          this.createPhase("validation", "Validation", "Validate offspring"),
        );
        break;
        
      default:
        phases.push(
          this.createPhase("research", "Research", "Gather required information"),
          this.createPhase("planning", "Planning", "Create execution plan"),
          this.createPhase("code_generation", "Execution", "Execute the plan"),
          this.createPhase("validation", "Validation", "Validate results"),
        );
    }
    
    // Set dependencies
    for (let i = 1; i < phases.length; i++) {
      phases[i].dependsOn = [phases[i - 1].id];
    }
    
    // Determine required capabilities
    const requiredCapabilities: CapabilityType[] = [];
    for (const phase of phases) {
      const caps = this.getCapabilitiesForPhase(phase.type);
      for (const cap of caps) {
        if (!requiredCapabilities.includes(cap)) {
          requiredCapabilities.push(cap);
        }
      }
    }
    
    return {
      id: randomUUID(),
      phases,
      estimatedDuration: phases.length * 60000, // Rough estimate
      estimatedTokens: phases.length * 1000,
      requiredCapabilities,
      risks: [],
      createdAt: Date.now(),
    };
  }
  
  private createPhase(type: PhaseType, name: string, description: string): MissionPhase {
    return {
      id: randomUUID(),
      name,
      description,
      type,
      status: "pending",
      actions: [],
      dependsOn: [],
    };
  }
  
  private getCapabilitiesForPhase(phaseType: PhaseType): CapabilityType[] {
    const mapping: Record<PhaseType, CapabilityType[]> = {
      research: ["web_browsing", "scraping", "model_usage"],
      planning: ["model_usage"],
      data_acquisition: ["scraping", "file_operations", "api_calls"],
      code_generation: ["code_generation", "file_operations"],
      ui_generation: ["ui_generation", "code_generation"],
      model_setup: ["model_usage"],
      voice_setup: ["voice_input", "voice_output"],
      testing: ["terminal", "code_generation"],
      validation: ["model_usage", "data_analysis"],
      deployment: ["terminal", "file_operations"],
      learning: ["learning", "model_usage"],
      analysis: ["data_analysis", "model_usage"],
    };
    
    return mapping[phaseType] || ["model_usage"];
  }
  
  private async executePhase(agent: AutonomousAgent, mission: Mission, phase: MissionPhase): Promise<void> {
    // Generate actions for this phase
    phase.actions = await this.generatePhaseActions(agent, mission, phase);
    
    // Execute each action
    for (const action of phase.actions) {
      if (action.status !== "pending") continue;
      
      this.emitEvent("action:started", agent.id, { 
        missionId: mission.id, 
        actionId: action.id, 
        actionType: action.type 
      });
      
      action.status = "executing";
      action.startedAt = Date.now();
      this.updateMission(mission);
      
      try {
        action.result = await this.executeAction(agent, mission, phase, action);
        action.status = "completed";
        mission.actionsPerformed++;
        agent.metrics.successfulActions++;
      } catch (error) {
        action.status = "failed";
        action.error = error instanceof Error ? error.message : String(error);
        mission.errorsEncountered++;
        this.emitEvent("action:failed", agent.id, { 
          missionId: mission.id, 
          actionId: action.id, 
          error: action.error 
        });
      }
      
      action.completedAt = Date.now();
      action.duration = action.completedAt - (action.startedAt || 0);
      agent.metrics.totalActions++;
      
      this.updateMission(mission);
      
      if (action.status === "completed") {
        this.emitEvent("action:completed", agent.id, { 
          missionId: mission.id, 
          actionId: action.id, 
          result: action.result 
        });
      }
    }
    
    // Set phase output
    phase.output = phase.actions
      .filter(a => a.status === "completed")
      .map(a => a.result);
  }
  
  private async generatePhaseActions(
    agent: AutonomousAgent, 
    mission: Mission, 
    phase: MissionPhase
  ): Promise<PhaseAction[]> {
    const actions: PhaseAction[] = [];
    
    switch (phase.type) {
      case "research":
      case "data_acquisition":
        actions.push({
          id: randomUUID(),
          type: "search_web",
          description: `Search for: ${mission.objective}`,
          status: "pending",
          params: { query: mission.objective },
        });
        actions.push({
          id: randomUUID(),
          type: "scrape_webpage",
          description: "Scrape relevant webpages",
          status: "pending",
          params: { followLinks: true, maxPages: 5 },
        });
        break;
        
      case "code_generation":
        actions.push({
          id: randomUUID(),
          type: "generate_code",
          description: `Generate code for: ${mission.objective}`,
          status: "pending",
          params: { 
            objective: mission.objective,
            context: mission.context,
            framework: "react", // Default
          },
        });
        actions.push({
          id: randomUUID(),
          type: "write_file",
          description: "Save generated code",
          status: "pending",
          params: {},
        });
        break;
        
      case "ui_generation":
        actions.push({
          id: randomUUID(),
          type: "generate_component",
          description: "Generate UI components",
          status: "pending",
          params: { objective: mission.objective },
        });
        actions.push({
          id: randomUUID(),
          type: "generate_style",
          description: "Generate styles",
          status: "pending",
          params: {},
        });
        break;
        
      case "voice_setup":
        if (agent.config.voiceEnabled) {
          actions.push({
            id: randomUUID(),
            type: "setup_voice",
            description: "Setup voice capabilities",
            status: "pending",
            params: { 
              model: agent.config.voiceModel,
              language: agent.config.voiceLanguage,
            },
          });
        }
        break;
        
      case "testing":
        actions.push({
          id: randomUUID(),
          type: "run_command",
          description: "Run tests",
          status: "pending",
          params: { command: "npm test" },
        });
        break;
        
      case "learning":
        actions.push({
          id: randomUUID(),
          type: "analyze_result",
          description: "Analyze mission results",
          status: "pending",
          params: {},
        });
        actions.push({
          id: randomUUID(),
          type: "extract_pattern",
          description: "Extract learned patterns",
          status: "pending",
          params: {},
        });
        actions.push({
          id: randomUUID(),
          type: "update_knowledge",
          description: "Update knowledge base",
          status: "pending",
          params: {},
        });
        break;
    }
    
    return actions;
  }
  
  private async executeAction(
    agent: AutonomousAgent,
    mission: Mission,
    phase: MissionPhase,
    action: PhaseAction
  ): Promise<ActionResult> {
    // Route file/command/scrape actions through the local-agent tool bridge
    // when a target app path is available on the mission.
    const targetAppPath = (mission as any).targetAppPath as string | undefined;
    if (hasBridgedTool(action.type) && targetAppPath) {
      const bridgeConfig: BridgeConfig = {
        appPath: targetAppPath,
        onOutput: (xml) => this.emit("action:output", { missionId: mission.id, xml }),
      };
      return executeViaBridge(action.type, action.params, bridgeConfig);
    }

    switch (action.type) {
      case "search_web":
        return this.executeWebSearch(action.params);
        
      case "scrape_webpage":
        return this.executeScrape(action.params);
        
      case "generate_code":
        return this.executeCodeGeneration(agent, action.params);
        
      case "generate_component":
        return this.executeUIGeneration(agent, action.params);
        
      case "generate_style":
        return this.executeStyleGeneration(agent, action.params);
        
      case "write_file":
        return this.executeFileWrite(action.params);
        
      case "read_file":
        return this.executeFileRead(action.params);
        
      case "run_command":
        return this.executeCommand(action.params);
        
      case "setup_voice":
        return this.executeVoiceSetup(agent, action.params);
        
      case "transcribe_audio":
        return this.executeTranscription(action.params);
        
      case "synthesize_speech":
        return this.executeSpeechSynthesis(agent, action.params);
        
      case "model_inference":
        return this.executeModelInference(agent, action.params);
        
      case "analyze_result":
        return this.executeAnalysis(mission);
        
      case "extract_pattern":
        return this.executePatternExtraction(agent, mission);
        
      case "update_knowledge":
        return this.executeKnowledgeUpdate(agent, mission);
        
      case "spawn_subagent":
        return this.executeSpawnSubagent(agent, action.params);
        
      case "evolve_self":
        return this.executeEvolution(agent);
        
      case "replicate":
        return this.executeReplication(agent, action.params);
        
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }
  
  // ===========================================================================
  // ACTION IMPLEMENTATIONS
  // ===========================================================================
  
  private async executeWebSearch(params: Record<string, unknown>): Promise<ActionResult> {
    const query = params.query as string;
    
    // Use DuckDuckGo or similar for search
    try {
      const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl);
      const html = await response.text();
      
      // Extract results (simplified)
      const results = this.parseSearchResults(html);
      
      return {
        success: true,
        output: { query, results },
        metrics: { timeMs: 0 },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private parseSearchResults(html: string): Array<{ title: string; url: string; snippet: string }> {
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    
    // Simple regex-based extraction (in production, use proper HTML parser)
    const linkRegex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
    let match;
    while ((match = linkRegex.exec(html)) !== null && results.length < 10) {
      results.push({
        url: match[1],
        title: match[2],
        snippet: "",
      });
    }
    
    return results;
  }
  
  private async executeScrape(params: Record<string, unknown>): Promise<ActionResult> {
    // Use existing scraper system
    const url = params.url as string;
    const followLinks = params.followLinks as boolean;
    const maxPages = (params.maxPages as number) || 5;
    
    try {
      // Fetch the page
      const response = await fetch(url);
      const html = await response.text();
      
      // Extract text content (simplified)
      const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      
      return {
        success: true,
        output: { url, content: textContent.substring(0, 10000) },
        metrics: { bytesProcessed: textContent.length },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeCodeGeneration(
    agent: AutonomousAgent, 
    params: Record<string, unknown>
  ): Promise<ActionResult> {
    const objective = params.objective as string;
    const context = params.context as string || "";
    const framework = params.framework as string || "react";
    
    // Use AI to generate code
    const prompt = `
You are an expert software developer. Generate high-quality, production-ready code.

Objective: ${objective}

Context: ${context}

Framework: ${framework}

Requirements:
1. Write clean, well-documented code
2. Include error handling
3. Follow best practices for ${framework}
4. Make it modular and reusable

Generate the complete code:
    `.trim();
    
    try {
      const code = await this.runModelInference(agent, prompt);
      
      // Save to artifacts
      const artifactId = randomUUID() as ArtifactId;
      const artifact: Artifact = {
        id: artifactId,
        type: "code",
        name: `generated-${Date.now()}.tsx`,
        description: objective,
        content: code,
        createdBy: agent.id,
        missionId: agent.currentMission!,
        phaseId: "",
        validated: false,
        createdAt: Date.now(),
      };
      
      this.artifacts.set(artifactId, artifact);
      
      return {
        success: true,
        output: { code },
        artifacts: [artifactId],
        metrics: { tokensUsed: code.length / 4 },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeUIGeneration(
    agent: AutonomousAgent,
    params: Record<string, unknown>
  ): Promise<ActionResult> {
    const objective = params.objective as string;
    
    const prompt = `
You are an expert UI/UX developer. Generate a complete React component with Tailwind CSS.

Objective: ${objective}

Requirements:
1. Modern, responsive design
2. Accessible (WCAG compliant)
3. Include hover states and transitions
4. Use Tailwind CSS for styling
5. Include TypeScript types
6. Add comments explaining the design decisions

Generate the complete React component:
    `.trim();
    
    try {
      const componentCode = await this.runModelInference(agent, prompt);
      
      return {
        success: true,
        output: { component: componentCode },
        metrics: { tokensUsed: componentCode.length / 4 },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeStyleGeneration(
    agent: AutonomousAgent,
    params: Record<string, unknown>
  ): Promise<ActionResult> {
    const prompt = `
Generate Tailwind CSS custom theme configuration with:
1. Custom color palette
2. Typography scale
3. Spacing system
4. Component variants

Output as tailwind.config.js:
    `.trim();
    
    try {
      const styleConfig = await this.runModelInference(agent, prompt);
      
      return {
        success: true,
        output: { styles: styleConfig },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeFileWrite(params: Record<string, unknown>): Promise<ActionResult> {
    const filePath = params.path as string;
    const content = params.content as string;
    
    if (!filePath || !content) {
      return { success: false, error: "Missing path or content" };
    }
    
    try {
      const fullPath = path.join(this.codeDir, filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, "utf-8");
      
      return {
        success: true,
        output: { path: fullPath },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeFileRead(params: Record<string, unknown>): Promise<ActionResult> {
    const filePath = params.path as string;
    
    try {
      const content = await fs.readFile(filePath, "utf-8");
      
      return {
        success: true,
        output: { path: filePath, content },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeCommand(params: Record<string, unknown>): Promise<ActionResult> {
    const command = params.command as string;
    const cwd = (params.cwd as string) || this.codeDir;
    
    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout: 60000 });
      
      return {
        success: true,
        output: { stdout, stderr },
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        output: { stdout: error.stdout, stderr: error.stderr },
      };
    }
  }
  
  private async executeVoiceSetup(
    agent: AutonomousAgent,
    params: Record<string, unknown>
  ): Promise<ActionResult> {
    const model = params.model as "piper" | "whisper" | "both";
    
    try {
      if (model === "whisper" || model === "both") {
        await this.downloadWhisperModel();
      }
      if (model === "piper" || model === "both") {
        await this.downloadPiperModel();
      }
      
      return {
        success: true,
        output: { model, setup: "complete" },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeTranscription(params: Record<string, unknown>): Promise<ActionResult> {
    const audioPath = params.audioPath as string;
    
    try {
      const whisperPath = path.join(this.voiceDir, "whisper", "main");
      const modelPath = path.join(this.voiceDir, "whisper", "base.bin");
      
      const { stdout } = await execAsync(
        `"${whisperPath}" -m "${modelPath}" -f "${audioPath}" --output-txt`,
        { timeout: 120000 }
      );
      
      return {
        success: true,
        output: { transcription: stdout.trim() },
        metrics: { timeMs: 0 },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeSpeechSynthesis(
    agent: AutonomousAgent,
    params: Record<string, unknown>
  ): Promise<ActionResult> {
    const text = params.text as string;
    const outputPath = params.outputPath as string || 
      path.join(this.voiceDir, "output", `speech-${Date.now()}.wav`);
    
    try {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      
      const piperPath = path.join(this.voiceDir, "piper", "piper");
      const modelPath = path.join(this.voiceDir, "piper", "en_US-lessac-medium.onnx");
      
      await execAsync(
        `echo "${text}" | "${piperPath}" --model "${modelPath}" --output_file "${outputPath}"`,
        { timeout: 30000 }
      );
      
      agent.metrics.speechSynthesized++;
      this.updateAgent(agent);
      
      return {
        success: true,
        output: { audioPath: outputPath },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeModelInference(
    agent: AutonomousAgent,
    params: Record<string, unknown>
  ): Promise<ActionResult> {
    const prompt = params.prompt as string;
    
    try {
      const response = await this.runModelInference(agent, prompt);
      
      return {
        success: true,
        output: { response },
        metrics: { tokensUsed: response.length / 4 },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async runModelInference(agent: AutonomousAgent, prompt: string): Promise<string> {
    // Use OpenClaw for AI inference - provides unified access to local (Ollama) and cloud (Anthropic)
    try {
      const OpenClaw = getOpenClawSystemIntegration();
      
      // Check if OpenClaw is initialized, if not use fallback
      const config = OpenClaw.getConfig();
      if (!config.enabled || !config.useForAgents) {
        // Fallback: use the user's configured AI provider via getModelClient
        return await this.runModelInferenceViaSettings(agent, prompt);
      }
      
      // Build system prompt from agent context
      const systemPrompt = `You are an autonomous AI agent named "${agent.name}" with the following capabilities: ${agent.capabilities.map(c => c.type).join(", ")}. Your purpose is: ${agent.purpose}. Current state: ${agent.state}.`;
      
      // Use OpenClaw for inference - prefers local Ollama, falls back to Anthropic
      const response = await OpenClaw.agentInference(agent.id, prompt, {
        systemPrompt,
        model: agent.config.primaryModel,
        temperature: agent.config.temperature || 0.7,
      });
      
      // Also emit event for monitoring/logging
      this.emit("model:inference:completed", {
        agentId: agent.id,
        model: agent.config.primaryModel,
        prompt: prompt.substring(0, 100),
        responseLength: response.length,
      });
      
      return response;
    } catch (error) {
      // Log error and emit event for external handling
      this.emit("model:inference:error", {
        agentId: agent.id,
        model: agent.config.primaryModel,
        error: error instanceof Error ? error.message : String(error),
      });
      
      // Try settings-based fallback if OpenClaw failed
      try {
        return await this.runModelInferenceViaSettings(agent, prompt);
      } catch {
        throw error; // Re-throw original if fallback also fails
      }
    }
  }
  
  /**
   * Fallback inference using the user's configured AI provider (same as chat).
   */
  private async runModelInferenceViaSettings(
    agent: AutonomousAgent,
    prompt: string,
  ): Promise<string> {
    const settings = readSettings();
    const { modelClient } = await getModelClient(
      settings.selectedModel,
      settings,
    );

    const systemPrompt = `You are an autonomous AI agent named "${agent.name}". Your purpose is: ${agent.purpose}. Respond concisely and precisely.`;

    const result = await generateText({
      model: modelClient.model,
      system: systemPrompt,
      prompt,
      maxOutputTokens: 4096,
      temperature: agent.config.temperature || 0.7,
    });

    this.emit("model:inference:completed", {
      agentId: agent.id,
      model: settings.selectedModel.name,
      prompt: prompt.substring(0, 100),
      responseLength: result.text.length,
    });

    return result.text;
  }
  
  private async executeAnalysis(mission: Mission): Promise<ActionResult> {
    // Analyze mission results
    const analysis = {
      totalPhases: mission.phases.length,
      completedPhases: mission.phases.filter(p => p.status === "completed").length,
      failedPhases: mission.phases.filter(p => p.status === "failed").length,
      totalActions: mission.actionsPerformed,
      errors: mission.errorsEncountered,
      artifacts: mission.artifacts.length,
    };
    
    return {
      success: true,
      output: analysis,
    };
  }
  
  private async executePatternExtraction(
    agent: AutonomousAgent,
    mission: Mission
  ): Promise<ActionResult> {
    const patterns: LearnedPattern[] = [];
    
    // Extract patterns from successful phases
    for (const phase of mission.phases) {
      if (phase.status === "completed") {
        patterns.push({
          id: randomUUID(),
          type: phase.type,
          description: `Successful ${phase.type} pattern`,
          pattern: JSON.stringify({ type: phase.type, actions: phase.actions.length }),
          examples: [phase.name],
          confidence: 0.7,
          usageCount: 1,
          successRate: 1,
          createdAt: Date.now(),
        });
      }
    }
    
    return {
      success: true,
      output: { patterns },
      learnings: patterns.map(p => p.description),
    };
  }
  
  private async executeKnowledgeUpdate(
    agent: AutonomousAgent,
    mission: Mission
  ): Promise<ActionResult> {
    // Update agent's knowledge base
    for (const learning of mission.learnings) {
      this.integrateKnowledge(agent, learning);
    }
    
    this.updateAgent(agent);
    
    return {
      success: true,
      output: { knowledgeEntries: agent.knowledge.totalEntries },
    };
  }
  
  private async executeSpawnSubagent(
    agent: AutonomousAgent,
    params: Record<string, unknown>
  ): Promise<ActionResult> {
    const purpose = params.purpose as string;
    
    try {
      const subagent = await this.replicateAgent(agent, purpose);
      
      return {
        success: true,
        output: { subagentId: subagent.id },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeEvolution(agent: AutonomousAgent): Promise<ActionResult> {
    try {
      await this.evolveAgent(agent);
      
      return {
        success: true,
        output: { evolutions: agent.metrics.evolutions },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  private async executeReplication(
    agent: AutonomousAgent,
    params: Record<string, unknown>
  ): Promise<ActionResult> {
    const specialization = params.specialization as string | undefined;
    
    try {
      const offspring = await this.replicateAgent(agent, specialization);
      
      return {
        success: true,
        output: { offspringId: offspring.id },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  
  // ===========================================================================
  // VALIDATION
  // ===========================================================================
  
  private async validateMission(agent: AutonomousAgent, mission: Mission): Promise<boolean> {
    // Check if all success criteria are met
    const allPhasesComplete = mission.phases.every(
      p => p.status === "completed" || p.status === "skipped"
    );
    
    const hasArtifacts = mission.artifacts.length > 0 || mission.type === "evolve";
    
    const errorRateAcceptable = 
      mission.errorsEncountered / Math.max(mission.actionsPerformed, 1) < 0.3;
    
    return allPhasesComplete && hasArtifacts && errorRateAcceptable;
  }
  
  private isCriticalPhase(phase: MissionPhase): boolean {
    return ["code_generation", "deployment"].includes(phase.type);
  }
  
  private updateMission(mission: Mission): void {
    if (!this.db) return;
    
    this.db.prepare(`
      UPDATE autonomous_missions SET
        status = ?, plan = ?, current_phase = ?, phases = ?,
        artifacts = ?, learnings = ?, started_at = ?, completed_at = ?,
        tokens_used = ?, actions_performed = ?, errors_encountered = ?,
        sub_mission_ids = ?
      WHERE id = ?
    `).run(
      mission.status,
      JSON.stringify(mission.plan),
      mission.currentPhase,
      JSON.stringify(mission.phases),
      JSON.stringify(mission.artifacts),
      JSON.stringify(mission.learnings),
      mission.startedAt,
      mission.completedAt,
      mission.tokensUsed,
      mission.actionsPerformed,
      mission.errorsEncountered,
      JSON.stringify(mission.subMissionIds),
      mission.id
    );
    
    this.missions.set(mission.id, mission);
  }
  
  // ===========================================================================
  // EVENT MANAGEMENT
  // ===========================================================================
  
  private emitEvent(
    type: AutonomousAgentEventType, 
    agentId: AutonomousAgentId, 
    data: Record<string, unknown>
  ): void {
    const event: AutonomousAgentEvent = {
      type,
      agentId,
      missionId: data.missionId as MissionId | undefined,
      timestamp: Date.now(),
      data,
    };
    
    // Save to database
    if (this.db) {
      this.db.prepare(`
        INSERT INTO autonomous_events (type, agent_id, mission_id, timestamp, data)
        VALUES (?, ?, ?, ?, ?)
      `).run(type, agentId, data.missionId || null, event.timestamp, JSON.stringify(data));
    }
    
    this.emit("event", event);
    this.emit(type, event);
  }
  
  // ===========================================================================
  // PUBLIC API
  // ===========================================================================
  
  async shutdown(): Promise<void> {
    // Stop all active processes
    for (const [id, process] of this.activeProcesses) {
      process.kill();
    }
    this.activeProcesses.clear();
    
    // Hibernate all active agents
    for (const agent of this.agents.values()) {
      if (agent.state === "active") {
        agent.state = "hibernating";
        this.updateAgent(agent);
      }
    }
    
    // Close database
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    
    this.initialized = false;
  }
  
  getAgent(agentId: AutonomousAgentId): AutonomousAgent | undefined {
    return this.agents.get(agentId);
  }
  
  listAgents(): AutonomousAgent[] {
    return Array.from(this.agents.values());
  }
  
  getMission(missionId: MissionId): Mission | undefined {
    return this.missions.get(missionId);
  }
  
  listMissions(agentId?: AutonomousAgentId): Mission[] {
    const missions = Array.from(this.missions.values());
    if (agentId) {
      return missions.filter(m => m.agentId === agentId);
    }
    return missions;
  }
  
  getArtifact(artifactId: ArtifactId): Artifact | undefined {
    return this.artifacts.get(artifactId);
  }
  
  listArtifacts(missionId?: MissionId): Artifact[] {
    const artifacts = Array.from(this.artifacts.values());
    if (missionId) {
      return artifacts.filter(a => a.missionId === missionId);
    }
    return artifacts;
  }
  
  async terminateAgent(agentId: AutonomousAgentId): Promise<void> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");
    
    agent.state = "terminated";
    agent.terminatedAt = Date.now();
    this.updateAgent(agent);
    
    this.emitEvent("agent:state_changed", agentId, { state: "terminated" });
  }
  
  getAgentStats(agentId: AutonomousAgentId): AgentPerformanceMetrics | undefined {
    const agent = this.agents.get(agentId);
    return agent?.metrics;
  }
  
  async getRecentEvents(agentId: AutonomousAgentId, limit = 100): Promise<AutonomousAgentEvent[]> {
    if (!this.db) return [];
    
    const rows = this.db.prepare(`
      SELECT * FROM autonomous_events
      WHERE agent_id = ?
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(agentId, limit) as any[];
    
    return rows.map(row => ({
      type: row.type,
      agentId: row.agent_id,
      missionId: row.mission_id,
      timestamp: row.timestamp,
      data: JSON.parse(row.data),
    }));
  }
  
  // Voice API
  async transcribeAudio(agentId: AutonomousAgentId, audioPath: string): Promise<string> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");
    
    const result = await this.executeTranscription({ audioPath });
    if (!result.success) throw new Error(result.error);
    
    agent.metrics.transcriptionsProcessed++;
    this.updateAgent(agent);
    
    return (result.output as any).transcription;
  }
  
  async synthesizeSpeech(agentId: AutonomousAgentId, text: string): Promise<string> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");
    
    const result = await this.executeSpeechSynthesis(agent, { text });
    if (!result.success) throw new Error(result.error);
    
    return (result.output as any).audioPath;
  }
}

// =============================================================================
// SINGLETON EXPORT
// =============================================================================

let autonomousAgentSystem: AutonomousAgentSystem | null = null;

export function getAutonomousAgentSystem(): AutonomousAgentSystem {
  if (!autonomousAgentSystem) {
    autonomousAgentSystem = AutonomousAgentSystem.getInstance();
  }
  return autonomousAgentSystem;
}
