/**
 * Agent Swarm System
 * Self-replicating, autonomous agent orchestration with witness capabilities
 *
 * Features:
 * - Self-replication: Agents can spawn sub-agents and clones
 * - Witness system: Agents can observe and learn from other agents
 * - Hierarchical coordination: Parent-child relationships with delegation
 * - Knowledge sharing: Cross-agent learning and memory transfer
 * - Resource management: Lifecycle, compute, and memory allocation
 * - Event-driven communication: Real-time agent messaging
 */

import { app } from "electron";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import Database from "better-sqlite3";

// =============================================================================
// BRANDED TYPES
// =============================================================================

export type SwarmId = string & { __brand: "SwarmId" };
export type AgentNodeId = string & { __brand: "AgentNodeId" };
export type WitnessId = string & { __brand: "WitnessId" };
export type ReplicationId = string & { __brand: "ReplicationId" };
export type MessageId = string & { __brand: "MessageId" };
export type KnowledgeId = string & { __brand: "KnowledgeId" };

// =============================================================================
// CORE TYPES
// =============================================================================

export type AgentNodeStatus =
  | "idle"
  | "spawning"
  | "running"
  | "waiting"
  | "observing"
  | "terminated"
  | "error";

export type SwarmStatus =
  | "initializing"
  | "active"
  | "paused"
  | "scaling"
  | "terminating"
  | "terminated";

export type ReplicationStrategy =
  | "clone" // Exact copy
  | "specialize" // Copy with narrowed focus
  | "generalize" // Copy with broader capabilities
  | "mutate" // Copy with random variations
  | "evolve"; // Copy with learned improvements

export type WitnessMode =
  | "passive" // Just observe, no interference
  | "learning" // Observe and extract patterns
  | "coaching" // Observe and provide feedback
  | "auditing"; // Observe and validate outputs

export type MessageType =
  | "task_assignment"
  | "task_result"
  | "knowledge_share"
  | "status_update"
  | "resource_request"
  | "coordination"
  | "witness_report"
  | "replication_request"
  | "termination"
  | "broadcast";

export type KnowledgeType =
  | "learned_pattern"
  | "best_practice"
  | "error_recovery"
  | "optimization"
  | "domain_expertise"
  | "tool_usage"
  | "user_preference";

// =============================================================================
// INTERFACES
// =============================================================================

export interface AgentNode {
  id: AgentNodeId;
  swarmId: SwarmId;
  name: string;
  role: AgentRole;
  status: AgentNodeStatus;
  parentId: AgentNodeId | null;
  childIds: AgentNodeId[];
  witnessIds: WitnessId[];
  capabilities: AgentCapability[];
  config: AgentNodeConfig;
  state: AgentState;
  resources: ResourceAllocation;
  metrics: AgentMetrics;
  createdAt: number;
  updatedAt: number;
  terminatedAt?: number;
  generation: number; // Replication depth
  lineage: AgentNodeId[]; // Ancestry chain
}

export type AgentRole =
  | "coordinator" // Manages swarm
  | "worker" // Executes tasks
  | "specialist" // Domain expert
  | "scout" // Research/exploration
  | "synthesizer" // Combines results
  | "validator" // Quality control
  | "witness" // Observes others
  | "replicator"; // Spawns new agents

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  proficiency: number; // 0-1
  inherited: boolean;
  learnedFrom?: AgentNodeId;
}

export interface AgentNodeConfig {
  modelId: string;
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  tools: string[];
  autoReplicate: boolean;
  maxChildren: number;
  maxGeneration: number;
  learningRate: number;
  shareKnowledge: boolean;
  acceptWitness: boolean;
}

export interface AgentState {
  currentTask?: TaskAssignment;
  pendingTasks: TaskAssignment[];
  completedTasks: number;
  failedTasks: number;
  memory: AgentMemory;
  context: Record<string, unknown>;
}

export interface AgentMemory {
  shortTerm: MemoryEntry[];
  longTerm: MemoryEntry[];
  shared: KnowledgeId[];
  capacity: number;
  used: number;
}

export interface MemoryEntry {
  id: string;
  type: "observation" | "result" | "feedback" | "learned";
  content: string;
  metadata: Record<string, unknown>;
  importance: number;
  timestamp: number;
  expiresAt?: number;
}

export interface ResourceAllocation {
  cpuUnits: number;
  memoryMb: number;
  maxConcurrentTasks: number;
  priority: number;
  quota: ResourceQuota;
}

export interface ResourceQuota {
  maxTokensPerHour: number;
  maxTasksPerHour: number;
  maxReplicationsPerHour: number;
  usedTokens: number;
  usedTasks: number;
  usedReplications: number;
  resetAt: number;
}

export interface AgentMetrics {
  totalTasks: number;
  successfulTasks: number;
  averageLatency: number;
  tokensUsed: number;
  replications: number;
  witnessContributions: number;
  knowledgeShared: number;
  uptime: number;
}

export interface TaskAssignment {
  id: string;
  type: TaskType;
  description: string;
  input: unknown;
  output?: unknown;
  status: "pending" | "running" | "completed" | "failed" | "delegated";
  priority: number;
  deadline?: number;
  assignedBy: AgentNodeId | "user";
  delegatedTo?: AgentNodeId;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export type TaskType =
  | "code"
  | "research"
  | "analysis"
  | "synthesis"
  | "validation"
  | "coordination"
  | "learning"
  | "custom";

export interface Swarm {
  id: SwarmId;
  name: string;
  description?: string;
  status: SwarmStatus;
  rootAgentId: AgentNodeId | null;
  config: SwarmConfig;
  metrics: SwarmMetrics;
  createdAt: number;
  updatedAt: number;
}

export interface SwarmConfig {
  maxAgents: number;
  maxGenerations: number;
  autoScale: boolean;
  scaleThreshold: number;
  terminationPolicy: "manual" | "idle_timeout" | "task_complete";
  idleTimeoutMs: number;
  sharedKnowledgeEnabled: boolean;
  witnessSystemEnabled: boolean;
  replicationEnabled: boolean;
}

export interface SwarmMetrics {
  totalAgents: number;
  activeAgents: number;
  totalTasks: number;
  completedTasks: number;
  averageLatency: number;
  totalTokens: number;
  totalReplications: number;
  knowledgeEntries: number;
}

export interface Witness {
  id: WitnessId;
  observerId: AgentNodeId;
  targetId: AgentNodeId;
  mode: WitnessMode;
  status: "active" | "paused" | "ended";
  observations: WitnessObservation[];
  insights: WitnessInsight[];
  startedAt: number;
  endedAt?: number;
}

export interface WitnessObservation {
  id: string;
  timestamp: number;
  eventType: string;
  data: unknown;
  analysis?: string;
}

export interface WitnessInsight {
  id: string;
  type: KnowledgeType;
  content: string;
  confidence: number;
  source: WitnessObservation[];
  createdAt: number;
}

export interface Replication {
  id: ReplicationId;
  parentId: AgentNodeId;
  childId: AgentNodeId;
  strategy: ReplicationStrategy;
  mutations: ReplicationMutation[];
  reason: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  createdAt: number;
  completedAt?: number;
}

export interface ReplicationMutation {
  field: string;
  originalValue: unknown;
  newValue: unknown;
  reason: string;
}

export interface AgentMessage {
  id: MessageId;
  type: MessageType;
  senderId: AgentNodeId | "system";
  recipientId: AgentNodeId | "broadcast";
  swarmId: SwarmId;
  payload: unknown;
  priority: number;
  requiresAck: boolean;
  acknowledged: boolean;
  createdAt: number;
  deliveredAt?: number;
  acknowledgedAt?: number;
}

export interface SharedKnowledge {
  id: KnowledgeId;
  swarmId: SwarmId;
  type: KnowledgeType;
  content: string;
  embedding?: number[];
  metadata: Record<string, unknown>;
  contributorId: AgentNodeId;
  usageCount: number;
  rating: number;
  createdAt: number;
  updatedAt: number;
}

export interface ReplicationRequest {
  strategy: ReplicationStrategy;
  reason: string;
  mutations?: Partial<AgentNodeConfig>;
  inheritCapabilities?: boolean;
  inheritKnowledge?: boolean;
  taskFocus?: string;
}

export interface SpawnRequest {
  name: string;
  role: AgentRole;
  config: Partial<AgentNodeConfig>;
  capabilities?: AgentCapability[];
  initialTask?: TaskAssignment;
}

// =============================================================================
// EVENT TYPES
// =============================================================================

export type SwarmEventType =
  | "swarm:created"
  | "swarm:started"
  | "swarm:paused"
  | "swarm:resumed"
  | "swarm:terminated"
  | "agent:spawned"
  | "agent:started"
  | "agent:stopped"
  | "agent:terminated"
  | "agent:replicated"
  | "task:assigned"
  | "task:started"
  | "task:completed"
  | "task:failed"
  | "task:delegated"
  | "witness:started"
  | "witness:insight"
  | "witness:ended"
  | "message:sent"
  | "message:delivered"
  | "knowledge:shared"
  | "knowledge:applied"
  | "resource:warning"
  | "resource:exceeded";

export interface SwarmEvent {
  id: string;
  type: SwarmEventType;
  swarmId: SwarmId;
  agentId?: AgentNodeId;
  data: unknown;
  timestamp: number;
}

// =============================================================================
// AGENT SWARM CLASS
// =============================================================================

let swarmInstance: AgentSwarm | null = null;

export function getAgentSwarm(): AgentSwarm {
  if (!swarmInstance) {
    swarmInstance = new AgentSwarm();
  }
  return swarmInstance;
}

export class AgentSwarm extends EventEmitter {
  private db: Database.Database | null = null;
  private swarms: Map<SwarmId, Swarm> = new Map();
  private agents: Map<AgentNodeId, AgentNode> = new Map();
  private witnesses: Map<WitnessId, Witness> = new Map();
  private messages: Map<MessageId, AgentMessage> = new Map();
  private knowledge: Map<KnowledgeId, SharedKnowledge> = new Map();
  private replications: Map<ReplicationId, Replication> = new Map();
  private initialized = false;

  // ---------------------------------------------------------------------------
  // INITIALIZATION
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const dbPath = path.join(app.getPath("userData"), "agent_swarm.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");

    this.createTables();
    await this.loadFromDatabase();
    this.initialized = true;
    this.emit("initialized");
  }

  private createTables(): void {
    if (!this.db) throw new Error("Database not initialized");

    // Swarms table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS swarms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'initializing',
        root_agent_id TEXT,
        config TEXT NOT NULL,
        metrics TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Agent nodes table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_nodes (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        parent_id TEXT,
        child_ids TEXT NOT NULL DEFAULT '[]',
        witness_ids TEXT NOT NULL DEFAULT '[]',
        capabilities TEXT NOT NULL DEFAULT '[]',
        config TEXT NOT NULL,
        state TEXT NOT NULL,
        resources TEXT NOT NULL,
        metrics TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        terminated_at INTEGER,
        generation INTEGER NOT NULL DEFAULT 0,
        lineage TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      )
    `);

    // Create FTS5 for agents
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS agent_nodes_fts USING fts5(
        name,
        role,
        content='agent_nodes',
        content_rowid='rowid'
      )
    `);

    // Witnesses table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS witnesses (
        id TEXT PRIMARY KEY,
        observer_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        observations TEXT NOT NULL DEFAULT '[]',
        insights TEXT NOT NULL DEFAULT '[]',
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        FOREIGN KEY (observer_id) REFERENCES agent_nodes(id),
        FOREIGN KEY (target_id) REFERENCES agent_nodes(id)
      )
    `);

    // Messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        sender_id TEXT NOT NULL,
        recipient_id TEXT NOT NULL,
        swarm_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        requires_ack INTEGER NOT NULL DEFAULT 0,
        acknowledged INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        delivered_at INTEGER,
        acknowledged_at INTEGER,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      )
    `);

    // Shared knowledge table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shared_knowledge (
        id TEXT PRIMARY KEY,
        swarm_id TEXT NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        contributor_id TEXT NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0,
        rating REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (swarm_id) REFERENCES swarms(id)
      )
    `);

    // Create FTS5 for knowledge
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS shared_knowledge_fts USING fts5(
        content,
        type,
        content='shared_knowledge',
        content_rowid='rowid'
      )
    `);

    // Replications table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS replications (
        id TEXT PRIMARY KEY,
        parent_id TEXT NOT NULL,
        child_id TEXT NOT NULL,
        strategy TEXT NOT NULL,
        mutations TEXT NOT NULL DEFAULT '[]',
        reason TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (parent_id) REFERENCES agent_nodes(id),
        FOREIGN KEY (child_id) REFERENCES agent_nodes(id)
      )
    `);

    // Events table for audit
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS swarm_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        swarm_id TEXT NOT NULL,
        agent_id TEXT,
        data TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);

    // Indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_agents_swarm ON agent_nodes(swarm_id);
      CREATE INDEX IF NOT EXISTS idx_agents_parent ON agent_nodes(parent_id);
      CREATE INDEX IF NOT EXISTS idx_agents_status ON agent_nodes(status);
      CREATE INDEX IF NOT EXISTS idx_witnesses_observer ON witnesses(observer_id);
      CREATE INDEX IF NOT EXISTS idx_witnesses_target ON witnesses(target_id);
      CREATE INDEX IF NOT EXISTS idx_messages_swarm ON agent_messages(swarm_id);
      CREATE INDEX IF NOT EXISTS idx_messages_recipient ON agent_messages(recipient_id);
      CREATE INDEX IF NOT EXISTS idx_knowledge_swarm ON shared_knowledge(swarm_id);
      CREATE INDEX IF NOT EXISTS idx_events_swarm ON swarm_events(swarm_id);
    `);
  }

  private async loadFromDatabase(): Promise<void> {
    if (!this.db) return;

    // Load swarms
    const swarmRows = this.db.prepare("SELECT * FROM swarms").all() as any[];
    for (const row of swarmRows) {
      const swarm: Swarm = {
        id: row.id as SwarmId,
        name: row.name,
        description: row.description,
        status: row.status,
        rootAgentId: row.root_agent_id as AgentNodeId | null,
        config: JSON.parse(row.config),
        metrics: JSON.parse(row.metrics),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      this.swarms.set(swarm.id, swarm);
    }

    // Load agents
    const agentRows = this.db
      .prepare("SELECT * FROM agent_nodes")
      .all() as any[];
    for (const row of agentRows) {
      const agent: AgentNode = {
        id: row.id as AgentNodeId,
        swarmId: row.swarm_id as SwarmId,
        name: row.name,
        role: row.role,
        status: row.status,
        parentId: row.parent_id as AgentNodeId | null,
        childIds: JSON.parse(row.child_ids),
        witnessIds: JSON.parse(row.witness_ids),
        capabilities: JSON.parse(row.capabilities),
        config: JSON.parse(row.config),
        state: JSON.parse(row.state),
        resources: JSON.parse(row.resources),
        metrics: JSON.parse(row.metrics),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        terminatedAt: row.terminated_at,
        generation: row.generation,
        lineage: JSON.parse(row.lineage),
      };
      this.agents.set(agent.id, agent);
    }

    // Load witnesses
    const witnessRows = this.db
      .prepare("SELECT * FROM witnesses")
      .all() as any[];
    for (const row of witnessRows) {
      const witness: Witness = {
        id: row.id as WitnessId,
        observerId: row.observer_id as AgentNodeId,
        targetId: row.target_id as AgentNodeId,
        mode: row.mode,
        status: row.status,
        observations: JSON.parse(row.observations),
        insights: JSON.parse(row.insights),
        startedAt: row.started_at,
        endedAt: row.ended_at,
      };
      this.witnesses.set(witness.id, witness);
    }

    // Load knowledge
    const knowledgeRows = this.db
      .prepare("SELECT * FROM shared_knowledge")
      .all() as any[];
    for (const row of knowledgeRows) {
      const k: SharedKnowledge = {
        id: row.id as KnowledgeId,
        swarmId: row.swarm_id as SwarmId,
        type: row.type,
        content: row.content,
        embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
        metadata: JSON.parse(row.metadata),
        contributorId: row.contributor_id as AgentNodeId,
        usageCount: row.usage_count,
        rating: row.rating,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      this.knowledge.set(k.id, k);
    }
  }

  async shutdown(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.initialized = false;
  }

  // ---------------------------------------------------------------------------
  // SWARM MANAGEMENT
  // ---------------------------------------------------------------------------

  async createSwarm(
    name: string,
    description?: string,
    config?: Partial<SwarmConfig>
  ): Promise<Swarm> {
    if (!this.db) throw new Error("Not initialized");

    const id = randomUUID() as SwarmId;
    const now = Date.now();

    const defaultConfig: SwarmConfig = {
      maxAgents: 50,
      maxGenerations: 5,
      autoScale: true,
      scaleThreshold: 0.8,
      terminationPolicy: "manual",
      idleTimeoutMs: 300000,
      sharedKnowledgeEnabled: true,
      witnessSystemEnabled: true,
      replicationEnabled: true,
    };

    const swarm: Swarm = {
      id,
      name,
      description,
      status: "initializing",
      rootAgentId: null,
      config: { ...defaultConfig, ...config },
      metrics: {
        totalAgents: 0,
        activeAgents: 0,
        totalTasks: 0,
        completedTasks: 0,
        averageLatency: 0,
        totalTokens: 0,
        totalReplications: 0,
        knowledgeEntries: 0,
      },
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO swarms (id, name, description, status, config, metrics, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        swarm.id,
        swarm.name,
        swarm.description || null,
        swarm.status,
        JSON.stringify(swarm.config),
        JSON.stringify(swarm.metrics),
        swarm.createdAt,
        swarm.updatedAt
      );

    this.swarms.set(swarm.id, swarm);
    this.emitEvent("swarm:created", swarm.id, undefined, { swarm });

    return swarm;
  }

  async getSwarm(swarmId: SwarmId): Promise<Swarm | null> {
    return this.swarms.get(swarmId) || null;
  }

  async listSwarms(): Promise<Swarm[]> {
    return Array.from(this.swarms.values());
  }

  async updateSwarm(
    swarmId: SwarmId,
    updates: Partial<Pick<Swarm, "name" | "description" | "config">>
  ): Promise<Swarm> {
    if (!this.db) throw new Error("Not initialized");

    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error("Swarm not found");

    const updated: Swarm = {
      ...swarm,
      ...updates,
      config: { ...swarm.config, ...updates.config },
      updatedAt: Date.now(),
    };

    this.db
      .prepare(
        `UPDATE swarms SET name = ?, description = ?, config = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        updated.name,
        updated.description || null,
        JSON.stringify(updated.config),
        updated.updatedAt,
        swarmId
      );

    this.swarms.set(swarmId, updated);
    return updated;
  }

  async startSwarm(swarmId: SwarmId): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error("Swarm not found");

    swarm.status = "active";
    swarm.updatedAt = Date.now();

    this.db
      .prepare(`UPDATE swarms SET status = ?, updated_at = ? WHERE id = ?`)
      .run(swarm.status, swarm.updatedAt, swarmId);

    this.emitEvent("swarm:started", swarmId, undefined, {});
  }

  async pauseSwarm(swarmId: SwarmId): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error("Swarm not found");

    swarm.status = "paused";
    swarm.updatedAt = Date.now();

    this.db
      .prepare(`UPDATE swarms SET status = ?, updated_at = ? WHERE id = ?`)
      .run(swarm.status, swarm.updatedAt, swarmId);

    this.emitEvent("swarm:paused", swarmId, undefined, {});
  }

  async terminateSwarm(swarmId: SwarmId): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error("Swarm not found");

    // Terminate all agents
    const agents = Array.from(this.agents.values()).filter(
      (a) => a.swarmId === swarmId
    );
    for (const agent of agents) {
      await this.terminateAgent(agent.id);
    }

    swarm.status = "terminated";
    swarm.updatedAt = Date.now();

    this.db
      .prepare(`UPDATE swarms SET status = ?, updated_at = ? WHERE id = ?`)
      .run(swarm.status, swarm.updatedAt, swarmId);

    this.emitEvent("swarm:terminated", swarmId, undefined, {});
  }

  async deleteSwarm(swarmId: SwarmId): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    // Clean up all related data
    this.db.prepare(`DELETE FROM swarm_events WHERE swarm_id = ?`).run(swarmId);
    this.db.prepare(`DELETE FROM agent_messages WHERE swarm_id = ?`).run(swarmId);
    this.db.prepare(`DELETE FROM shared_knowledge WHERE swarm_id = ?`).run(swarmId);
    
    const agents = Array.from(this.agents.values()).filter(a => a.swarmId === swarmId);
    for (const agent of agents) {
      this.db.prepare(`DELETE FROM witnesses WHERE observer_id = ? OR target_id = ?`).run(agent.id, agent.id);
      this.db.prepare(`DELETE FROM replications WHERE parent_id = ? OR child_id = ?`).run(agent.id, agent.id);
      this.agents.delete(agent.id);
    }
    this.db.prepare(`DELETE FROM agent_nodes WHERE swarm_id = ?`).run(swarmId);
    this.db.prepare(`DELETE FROM swarms WHERE id = ?`).run(swarmId);

    this.swarms.delete(swarmId);
  }

  // ---------------------------------------------------------------------------
  // AGENT SPAWNING & MANAGEMENT
  // ---------------------------------------------------------------------------

  async spawnAgent(
    swarmId: SwarmId,
    request: SpawnRequest,
    parentId?: AgentNodeId
  ): Promise<AgentNode> {
    if (!this.db) throw new Error("Not initialized");

    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error("Swarm not found");

    if (swarm.metrics.totalAgents >= swarm.config.maxAgents) {
      throw new Error("Swarm has reached maximum agent limit");
    }

    const parent = parentId ? this.agents.get(parentId) : null;
    if (parent && parent.generation >= swarm.config.maxGenerations) {
      throw new Error("Maximum generation depth reached");
    }

    const id = randomUUID() as AgentNodeId;
    const now = Date.now();

    const defaultConfig: AgentNodeConfig = {
      modelId: "gpt-5-mini",
      temperature: 0.7,
      maxTokens: 4096,
      systemPrompt: `You are an AI agent in a swarm. Your role: ${request.role}.`,
      tools: [],
      autoReplicate: false,
      maxChildren: 5,
      maxGeneration: 3,
      learningRate: 0.1,
      shareKnowledge: true,
      acceptWitness: true,
    };

    const agent: AgentNode = {
      id,
      swarmId,
      name: request.name,
      role: request.role,
      status: "idle",
      parentId: parentId || null,
      childIds: [],
      witnessIds: [],
      capabilities: request.capabilities || [],
      config: { ...defaultConfig, ...request.config },
      state: {
        pendingTasks: [],
        completedTasks: 0,
        failedTasks: 0,
        memory: {
          shortTerm: [],
          longTerm: [],
          shared: [],
          capacity: 1000,
          used: 0,
        },
        context: {},
      },
      resources: {
        cpuUnits: 1,
        memoryMb: 512,
        maxConcurrentTasks: 3,
        priority: 1,
        quota: {
          maxTokensPerHour: 100000,
          maxTasksPerHour: 100,
          maxReplicationsPerHour: 10,
          usedTokens: 0,
          usedTasks: 0,
          usedReplications: 0,
          resetAt: now + 3600000,
        },
      },
      metrics: {
        totalTasks: 0,
        successfulTasks: 0,
        averageLatency: 0,
        tokensUsed: 0,
        replications: 0,
        witnessContributions: 0,
        knowledgeShared: 0,
        uptime: 0,
      },
      createdAt: now,
      updatedAt: now,
      generation: parent ? parent.generation + 1 : 0,
      lineage: parent ? [...parent.lineage, parent.id] : [],
    };

    // Update parent's child list
    if (parent) {
      parent.childIds.push(id);
      parent.updatedAt = now;
      this.db
        .prepare(`UPDATE agent_nodes SET child_ids = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(parent.childIds), parent.updatedAt, parent.id);
    }

    // If no root agent, this is the root
    if (!swarm.rootAgentId) {
      swarm.rootAgentId = id;
      this.db
        .prepare(`UPDATE swarms SET root_agent_id = ? WHERE id = ?`)
        .run(id, swarmId);
    }

    // Save agent
    this.db
      .prepare(
        `INSERT INTO agent_nodes 
        (id, swarm_id, name, role, status, parent_id, child_ids, witness_ids, capabilities, config, state, resources, metrics, created_at, updated_at, generation, lineage)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        agent.id,
        agent.swarmId,
        agent.name,
        agent.role,
        agent.status,
        agent.parentId,
        JSON.stringify(agent.childIds),
        JSON.stringify(agent.witnessIds),
        JSON.stringify(agent.capabilities),
        JSON.stringify(agent.config),
        JSON.stringify(agent.state),
        JSON.stringify(agent.resources),
        JSON.stringify(agent.metrics),
        agent.createdAt,
        agent.updatedAt,
        agent.generation,
        JSON.stringify(agent.lineage)
      );

    // Update FTS
    this.db
      .prepare(`INSERT INTO agent_nodes_fts (rowid, name, role) SELECT rowid, name, role FROM agent_nodes WHERE id = ?`)
      .run(agent.id);

    // Update swarm metrics
    swarm.metrics.totalAgents++;
    swarm.metrics.activeAgents++;
    swarm.updatedAt = now;
    this.db
      .prepare(`UPDATE swarms SET metrics = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(swarm.metrics), swarm.updatedAt, swarmId);

    this.agents.set(agent.id, agent);
    this.emitEvent("agent:spawned", swarmId, id, { agent, parentId });

    // Handle initial task if provided
    if (request.initialTask) {
      await this.assignTask(id, request.initialTask);
    }

    return agent;
  }

  async getAgent(agentId: AgentNodeId): Promise<AgentNode | null> {
    return this.agents.get(agentId) || null;
  }

  async listAgents(swarmId: SwarmId): Promise<AgentNode[]> {
    return Array.from(this.agents.values()).filter((a) => a.swarmId === swarmId);
  }

  async getAgentChildren(agentId: AgentNodeId): Promise<AgentNode[]> {
    const agent = this.agents.get(agentId);
    if (!agent) return [];

    return agent.childIds
      .map((id) => this.agents.get(id))
      .filter((a): a is AgentNode => a !== undefined);
  }

  async getAgentLineage(agentId: AgentNodeId): Promise<AgentNode[]> {
    const agent = this.agents.get(agentId);
    if (!agent) return [];

    return agent.lineage
      .map((id) => this.agents.get(id))
      .filter((a): a is AgentNode => a !== undefined);
  }

  async updateAgent(
    agentId: AgentNodeId,
    updates: Partial<Pick<AgentNode, "name" | "config" | "resources">>
  ): Promise<AgentNode> {
    if (!this.db) throw new Error("Not initialized");

    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");

    const updated: AgentNode = {
      ...agent,
      ...updates,
      config: { ...agent.config, ...updates.config },
      resources: { ...agent.resources, ...updates.resources },
      updatedAt: Date.now(),
    };

    this.db
      .prepare(
        `UPDATE agent_nodes SET name = ?, config = ?, resources = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        updated.name,
        JSON.stringify(updated.config),
        JSON.stringify(updated.resources),
        updated.updatedAt,
        agentId
      );

    this.agents.set(agentId, updated);
    return updated;
  }

  async startAgent(agentId: AgentNodeId): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");

    agent.status = "running";
    agent.updatedAt = Date.now();

    this.db
      .prepare(`UPDATE agent_nodes SET status = ?, updated_at = ? WHERE id = ?`)
      .run(agent.status, agent.updatedAt, agentId);

    this.emitEvent("agent:started", agent.swarmId, agentId, {});
  }

  async stopAgent(agentId: AgentNodeId): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");

    agent.status = "idle";
    agent.updatedAt = Date.now();

    this.db
      .prepare(`UPDATE agent_nodes SET status = ?, updated_at = ? WHERE id = ?`)
      .run(agent.status, agent.updatedAt, agentId);

    this.emitEvent("agent:stopped", agent.swarmId, agentId, {});
  }

  async terminateAgent(agentId: AgentNodeId): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");

    const now = Date.now();
    agent.status = "terminated";
    agent.terminatedAt = now;
    agent.updatedAt = now;

    this.db
      .prepare(
        `UPDATE agent_nodes SET status = ?, terminated_at = ?, updated_at = ? WHERE id = ?`
      )
      .run(agent.status, agent.terminatedAt, agent.updatedAt, agentId);

    // Update swarm metrics
    const swarm = this.swarms.get(agent.swarmId);
    if (swarm) {
      swarm.metrics.activeAgents--;
      swarm.updatedAt = now;
      this.db
        .prepare(`UPDATE swarms SET metrics = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(swarm.metrics), swarm.updatedAt, agent.swarmId);
    }

    this.emitEvent("agent:terminated", agent.swarmId, agentId, {});
  }

  // ---------------------------------------------------------------------------
  // SELF-REPLICATION
  // ---------------------------------------------------------------------------

  async replicateAgent(
    agentId: AgentNodeId,
    request: ReplicationRequest
  ): Promise<AgentNode> {
    if (!this.db) throw new Error("Not initialized");

    const parent = this.agents.get(agentId);
    if (!parent) throw new Error("Parent agent not found");

    const swarm = this.swarms.get(parent.swarmId);
    if (!swarm) throw new Error("Swarm not found");

    if (!swarm.config.replicationEnabled) {
      throw new Error("Replication is disabled for this swarm");
    }

    // Check quota
    if (
      parent.resources.quota.usedReplications >=
      parent.resources.quota.maxReplicationsPerHour
    ) {
      throw new Error("Replication quota exceeded");
    }

    const replicationId = randomUUID() as ReplicationId;
    const mutations: ReplicationMutation[] = [];

    // Build child config based on strategy
    let childConfig: Partial<AgentNodeConfig> = { ...parent.config };
    let childCapabilities = request.inheritCapabilities
      ? [...parent.capabilities]
      : [];
    let childName = `${parent.name}-replica-${parent.metrics.replications + 1}`;
    let childRole = parent.role;

    switch (request.strategy) {
      case "clone":
        // Exact copy
        break;

      case "specialize":
        // Narrow focus
        if (request.taskFocus) {
          childConfig.systemPrompt = `${parent.config.systemPrompt}\n\nSPECIALIZATION: Focus on ${request.taskFocus}`;
          childName = `${parent.name}-specialist`;
          childRole = "specialist";
          mutations.push({
            field: "systemPrompt",
            originalValue: parent.config.systemPrompt,
            newValue: childConfig.systemPrompt,
            reason: `Specialized for: ${request.taskFocus}`,
          });
        }
        break;

      case "generalize":
        // Broader capabilities
        childConfig.temperature = Math.min(1, parent.config.temperature + 0.1);
        childConfig.systemPrompt = `${parent.config.systemPrompt}\n\nGENERALIZATION: Be flexible and adaptable.`;
        mutations.push({
          field: "temperature",
          originalValue: parent.config.temperature,
          newValue: childConfig.temperature,
          reason: "Increased creativity for generalization",
        });
        break;

      case "mutate":
        // Random variations
        childConfig.temperature =
          Math.random() * 0.4 + 0.5; // 0.5-0.9
        childConfig.learningRate =
          Math.random() * 0.2 + 0.05; // 0.05-0.25
        mutations.push({
          field: "temperature",
          originalValue: parent.config.temperature,
          newValue: childConfig.temperature,
          reason: "Random mutation",
        });
        break;

      case "evolve":
        // Learn from parent's successes
        const successRate =
          parent.metrics.successfulTasks /
          Math.max(1, parent.metrics.totalTasks);
        if (successRate > 0.8) {
          // Keep similar settings
          childConfig.temperature = Math.max(
            0.1,
            parent.config.temperature - 0.05
          );
        } else {
          // Try different settings
          childConfig.temperature = Math.min(
            1,
            parent.config.temperature + 0.1
          );
        }
        mutations.push({
          field: "temperature",
          originalValue: parent.config.temperature,
          newValue: childConfig.temperature,
          reason: `Evolved based on ${(successRate * 100).toFixed(1)}% success rate`,
        });
        break;
    }

    // Apply explicit mutations
    if (request.mutations) {
      Object.entries(request.mutations).forEach(([key, value]) => {
        const original = (childConfig as any)[key];
        (childConfig as any)[key] = value;
        mutations.push({
          field: key,
          originalValue: original,
          newValue: value,
          reason: "Explicit mutation",
        });
      });
    }

    // Create replication record
    const replication: Replication = {
      id: replicationId,
      parentId: agentId,
      childId: "" as AgentNodeId, // Will be set after spawn
      strategy: request.strategy,
      mutations,
      reason: request.reason,
      status: "in_progress",
      createdAt: Date.now(),
    };

    // Spawn the child
    const child = await this.spawnAgent(
      parent.swarmId,
      {
        name: childName,
        role: childRole,
        config: childConfig,
        capabilities: childCapabilities,
      },
      agentId
    );

    // Update replication record
    replication.childId = child.id;
    replication.status = "completed";
    replication.completedAt = Date.now();

    this.db
      .prepare(
        `INSERT INTO replications (id, parent_id, child_id, strategy, mutations, reason, status, created_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        replication.id,
        replication.parentId,
        replication.childId,
        replication.strategy,
        JSON.stringify(replication.mutations),
        replication.reason,
        replication.status,
        replication.createdAt,
        replication.completedAt
      );

    this.replications.set(replication.id, replication);

    // Update parent metrics
    parent.metrics.replications++;
    parent.resources.quota.usedReplications++;
    parent.updatedAt = Date.now();
    this.db
      .prepare(
        `UPDATE agent_nodes SET metrics = ?, resources = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        JSON.stringify(parent.metrics),
        JSON.stringify(parent.resources),
        parent.updatedAt,
        agentId
      );

    // Update swarm metrics
    swarm.metrics.totalReplications++;
    swarm.updatedAt = Date.now();
    this.db
      .prepare(`UPDATE swarms SET metrics = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(swarm.metrics), swarm.updatedAt, parent.swarmId);

    // Transfer knowledge if requested
    if (request.inheritKnowledge) {
      for (const knowledgeId of parent.state.memory.shared) {
        child.state.memory.shared.push(knowledgeId);
      }
      this.db
        .prepare(`UPDATE agent_nodes SET state = ? WHERE id = ?`)
        .run(JSON.stringify(child.state), child.id);
    }

    this.emitEvent("agent:replicated", parent.swarmId, child.id, {
      replication,
      parent: agentId,
    });

    return child;
  }

  async listReplications(agentId?: AgentNodeId): Promise<Replication[]> {
    if (agentId) {
      return Array.from(this.replications.values()).filter(
        (r) => r.parentId === agentId || r.childId === agentId
      );
    }
    return Array.from(this.replications.values());
  }

  // ---------------------------------------------------------------------------
  // WITNESS SYSTEM
  // ---------------------------------------------------------------------------

  async startWitness(
    observerId: AgentNodeId,
    targetId: AgentNodeId,
    mode: WitnessMode
  ): Promise<Witness> {
    if (!this.db) throw new Error("Not initialized");

    const observer = this.agents.get(observerId);
    const target = this.agents.get(targetId);

    if (!observer) throw new Error("Observer agent not found");
    if (!target) throw new Error("Target agent not found");
    if (!target.config.acceptWitness) {
      throw new Error("Target agent does not accept witnesses");
    }

    const swarm = this.swarms.get(observer.swarmId);
    if (!swarm?.config.witnessSystemEnabled) {
      throw new Error("Witness system is disabled for this swarm");
    }

    const id = randomUUID() as WitnessId;
    const now = Date.now();

    const witness: Witness = {
      id,
      observerId,
      targetId,
      mode,
      status: "active",
      observations: [],
      insights: [],
      startedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO witnesses (id, observer_id, target_id, mode, status, observations, insights, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        witness.id,
        witness.observerId,
        witness.targetId,
        witness.mode,
        witness.status,
        JSON.stringify(witness.observations),
        JSON.stringify(witness.insights),
        witness.startedAt
      );

    // Update both agents
    observer.witnessIds.push(id);
    target.witnessIds.push(id);
    this.db
      .prepare(`UPDATE agent_nodes SET witness_ids = ? WHERE id = ?`)
      .run(JSON.stringify(observer.witnessIds), observerId);
    this.db
      .prepare(`UPDATE agent_nodes SET witness_ids = ? WHERE id = ?`)
      .run(JSON.stringify(target.witnessIds), targetId);

    this.witnesses.set(witness.id, witness);
    this.emitEvent("witness:started", observer.swarmId, observerId, {
      witness,
      targetId,
    });

    return witness;
  }

  async recordObservation(
    witnessId: WitnessId,
    eventType: string,
    data: unknown,
    analysis?: string
  ): Promise<WitnessObservation> {
    if (!this.db) throw new Error("Not initialized");

    const witness = this.witnesses.get(witnessId);
    if (!witness) throw new Error("Witness not found");
    if (witness.status !== "active") throw new Error("Witness is not active");

    const observation: WitnessObservation = {
      id: randomUUID(),
      timestamp: Date.now(),
      eventType,
      data,
      analysis,
    };

    witness.observations.push(observation);

    this.db
      .prepare(`UPDATE witnesses SET observations = ? WHERE id = ?`)
      .run(JSON.stringify(witness.observations), witnessId);

    return observation;
  }

  async addWitnessInsight(
    witnessId: WitnessId,
    type: KnowledgeType,
    content: string,
    confidence: number,
    sourceObservationIds: string[]
  ): Promise<WitnessInsight> {
    if (!this.db) throw new Error("Not initialized");

    const witness = this.witnesses.get(witnessId);
    if (!witness) throw new Error("Witness not found");

    const sourceObservations = witness.observations.filter((o) =>
      sourceObservationIds.includes(o.id)
    );

    const insight: WitnessInsight = {
      id: randomUUID(),
      type,
      content,
      confidence,
      source: sourceObservations,
      createdAt: Date.now(),
    };

    witness.insights.push(insight);

    this.db
      .prepare(`UPDATE witnesses SET insights = ? WHERE id = ?`)
      .run(JSON.stringify(witness.insights), witnessId);

    // Update observer's metrics
    const observer = this.agents.get(witness.observerId);
    if (observer) {
      observer.metrics.witnessContributions++;
      this.db
        .prepare(`UPDATE agent_nodes SET metrics = ? WHERE id = ?`)
        .run(JSON.stringify(observer.metrics), observer.id);
    }

    this.emitEvent("witness:insight", observer?.swarmId!, witness.observerId, {
      witness: witnessId,
      insight,
    });

    return insight;
  }

  async endWitness(witnessId: WitnessId): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const witness = this.witnesses.get(witnessId);
    if (!witness) throw new Error("Witness not found");

    witness.status = "ended";
    witness.endedAt = Date.now();

    this.db
      .prepare(`UPDATE witnesses SET status = ?, ended_at = ? WHERE id = ?`)
      .run(witness.status, witness.endedAt, witnessId);

    const observer = this.agents.get(witness.observerId);
    this.emitEvent("witness:ended", observer?.swarmId!, witness.observerId, {
      witnessId,
      insights: witness.insights.length,
    });
  }

  async getWitness(witnessId: WitnessId): Promise<Witness | null> {
    return this.witnesses.get(witnessId) || null;
  }

  async listWitnesses(agentId?: AgentNodeId): Promise<Witness[]> {
    if (agentId) {
      return Array.from(this.witnesses.values()).filter(
        (w) => w.observerId === agentId || w.targetId === agentId
      );
    }
    return Array.from(this.witnesses.values());
  }

  // ---------------------------------------------------------------------------
  // TASK MANAGEMENT
  // ---------------------------------------------------------------------------

  async assignTask(
    agentId: AgentNodeId,
    task: Omit<TaskAssignment, "id" | "status" | "createdAt">
  ): Promise<TaskAssignment> {
    if (!this.db) throw new Error("Not initialized");

    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");

    const fullTask: TaskAssignment = {
      ...task,
      id: randomUUID(),
      status: "pending",
      createdAt: Date.now(),
    };

    agent.state.pendingTasks.push(fullTask);
    agent.updatedAt = Date.now();

    this.db
      .prepare(`UPDATE agent_nodes SET state = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(agent.state), agent.updatedAt, agentId);

    // Update swarm metrics
    const swarm = this.swarms.get(agent.swarmId);
    if (swarm) {
      swarm.metrics.totalTasks++;
      this.db
        .prepare(`UPDATE swarms SET metrics = ? WHERE id = ?`)
        .run(JSON.stringify(swarm.metrics), agent.swarmId);
    }

    this.emitEvent("task:assigned", agent.swarmId, agentId, { task: fullTask });

    return fullTask;
  }

  async delegateTask(
    fromAgentId: AgentNodeId,
    toAgentId: AgentNodeId,
    taskId: string
  ): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const fromAgent = this.agents.get(fromAgentId);
    const toAgent = this.agents.get(toAgentId);

    if (!fromAgent) throw new Error("Source agent not found");
    if (!toAgent) throw new Error("Target agent not found");

    const taskIndex = fromAgent.state.pendingTasks.findIndex(
      (t) => t.id === taskId
    );
    if (taskIndex === -1) throw new Error("Task not found");

    const task = fromAgent.state.pendingTasks[taskIndex];
    task.status = "delegated";
    task.delegatedTo = toAgentId;

    // Move task to target
    fromAgent.state.pendingTasks.splice(taskIndex, 1);
    task.status = "pending";
    toAgent.state.pendingTasks.push(task);

    const now = Date.now();
    fromAgent.updatedAt = now;
    toAgent.updatedAt = now;

    this.db
      .prepare(`UPDATE agent_nodes SET state = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(fromAgent.state), fromAgent.updatedAt, fromAgentId);
    this.db
      .prepare(`UPDATE agent_nodes SET state = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(toAgent.state), toAgent.updatedAt, toAgentId);

    this.emitEvent("task:delegated", fromAgent.swarmId, fromAgentId, {
      task,
      toAgent: toAgentId,
    });
  }

  async completeTask(
    agentId: AgentNodeId,
    taskId: string,
    output: unknown
  ): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");

    const task =
      agent.state.currentTask?.id === taskId
        ? agent.state.currentTask
        : agent.state.pendingTasks.find((t) => t.id === taskId);

    if (!task) throw new Error("Task not found");

    task.status = "completed";
    task.output = output;
    task.completedAt = Date.now();

    if (agent.state.currentTask?.id === taskId) {
      agent.state.currentTask = undefined;
    } else {
      const index = agent.state.pendingTasks.findIndex((t) => t.id === taskId);
      if (index !== -1) agent.state.pendingTasks.splice(index, 1);
    }

    agent.state.completedTasks++;
    agent.metrics.totalTasks++;
    agent.metrics.successfulTasks++;
    agent.updatedAt = Date.now();

    this.db
      .prepare(
        `UPDATE agent_nodes SET state = ?, metrics = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        JSON.stringify(agent.state),
        JSON.stringify(agent.metrics),
        agent.updatedAt,
        agentId
      );

    // Update swarm metrics
    const swarm = this.swarms.get(agent.swarmId);
    if (swarm) {
      swarm.metrics.completedTasks++;
      this.db
        .prepare(`UPDATE swarms SET metrics = ? WHERE id = ?`)
        .run(JSON.stringify(swarm.metrics), agent.swarmId);
    }

    this.emitEvent("task:completed", agent.swarmId, agentId, { task });
  }

  async failTask(
    agentId: AgentNodeId,
    taskId: string,
    error: string
  ): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");

    const task =
      agent.state.currentTask?.id === taskId
        ? agent.state.currentTask
        : agent.state.pendingTasks.find((t) => t.id === taskId);

    if (!task) throw new Error("Task not found");

    task.status = "failed";
    task.error = error;
    task.completedAt = Date.now();

    if (agent.state.currentTask?.id === taskId) {
      agent.state.currentTask = undefined;
    }

    agent.state.failedTasks++;
    agent.metrics.totalTasks++;
    agent.updatedAt = Date.now();

    this.db
      .prepare(
        `UPDATE agent_nodes SET state = ?, metrics = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        JSON.stringify(agent.state),
        JSON.stringify(agent.metrics),
        agent.updatedAt,
        agentId
      );

    this.emitEvent("task:failed", agent.swarmId, agentId, { task, error });
  }

  // ---------------------------------------------------------------------------
  // INTER-AGENT MESSAGING
  // ---------------------------------------------------------------------------

  async sendMessage(
    senderId: AgentNodeId | "system",
    recipientId: AgentNodeId | "broadcast",
    swarmId: SwarmId,
    type: MessageType,
    payload: unknown,
    options?: { priority?: number; requiresAck?: boolean }
  ): Promise<AgentMessage> {
    if (!this.db) throw new Error("Not initialized");

    const id = randomUUID() as MessageId;
    const now = Date.now();

    const message: AgentMessage = {
      id,
      type,
      senderId,
      recipientId,
      swarmId,
      payload,
      priority: options?.priority ?? 0,
      requiresAck: options?.requiresAck ?? false,
      acknowledged: false,
      createdAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO agent_messages (id, type, sender_id, recipient_id, swarm_id, payload, priority, requires_ack, acknowledged, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        message.id,
        message.type,
        message.senderId,
        message.recipientId,
        message.swarmId,
        JSON.stringify(message.payload),
        message.priority,
        message.requiresAck ? 1 : 0,
        0,
        message.createdAt
      );

    this.messages.set(message.id, message);
    this.emitEvent("message:sent", swarmId, senderId as AgentNodeId, {
      message,
    });

    // Deliver immediately if not broadcast
    if (recipientId !== "broadcast") {
      await this.deliverMessage(id);
    } else {
      // Deliver to all agents in swarm
      const agents = Array.from(this.agents.values()).filter(
        (a) => a.swarmId === swarmId && a.id !== senderId
      );
      for (const agent of agents) {
        this.emitEvent("message:delivered", swarmId, agent.id, { message });
      }
    }

    return message;
  }

  private async deliverMessage(messageId: MessageId): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const message = this.messages.get(messageId);
    if (!message) return;

    message.deliveredAt = Date.now();

    this.db
      .prepare(`UPDATE agent_messages SET delivered_at = ? WHERE id = ?`)
      .run(message.deliveredAt, messageId);

    this.emitEvent(
      "message:delivered",
      message.swarmId,
      message.recipientId as AgentNodeId,
      { message }
    );
  }

  async acknowledgeMessage(messageId: MessageId): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const message = this.messages.get(messageId);
    if (!message) throw new Error("Message not found");

    message.acknowledged = true;
    message.acknowledgedAt = Date.now();

    this.db
      .prepare(
        `UPDATE agent_messages SET acknowledged = 1, acknowledged_at = ? WHERE id = ?`
      )
      .run(message.acknowledgedAt, messageId);
  }

  async listMessages(
    agentId?: AgentNodeId,
    swarmId?: SwarmId
  ): Promise<AgentMessage[]> {
    let messages = Array.from(this.messages.values());

    if (swarmId) {
      messages = messages.filter((m) => m.swarmId === swarmId);
    }

    if (agentId) {
      messages = messages.filter(
        (m) =>
          m.senderId === agentId ||
          m.recipientId === agentId ||
          m.recipientId === "broadcast"
      );
    }

    return messages.sort((a, b) => b.createdAt - a.createdAt);
  }

  // ---------------------------------------------------------------------------
  // KNOWLEDGE SHARING
  // ---------------------------------------------------------------------------

  async shareKnowledge(
    contributorId: AgentNodeId,
    type: KnowledgeType,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<SharedKnowledge> {
    if (!this.db) throw new Error("Not initialized");

    const contributor = this.agents.get(contributorId);
    if (!contributor) throw new Error("Contributor not found");

    const swarm = this.swarms.get(contributor.swarmId);
    if (!swarm?.config.sharedKnowledgeEnabled) {
      throw new Error("Knowledge sharing is disabled for this swarm");
    }

    const id = randomUUID() as KnowledgeId;
    const now = Date.now();

    const knowledge: SharedKnowledge = {
      id,
      swarmId: contributor.swarmId,
      type,
      content,
      metadata: metadata || {},
      contributorId,
      usageCount: 0,
      rating: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO shared_knowledge (id, swarm_id, type, content, metadata, contributor_id, usage_count, rating, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        knowledge.id,
        knowledge.swarmId,
        knowledge.type,
        knowledge.content,
        JSON.stringify(knowledge.metadata),
        knowledge.contributorId,
        knowledge.usageCount,
        knowledge.rating,
        knowledge.createdAt,
        knowledge.updatedAt
      );

    // Update FTS
    this.db
      .prepare(
        `INSERT INTO shared_knowledge_fts (rowid, content, type) SELECT rowid, content, type FROM shared_knowledge WHERE id = ?`
      )
      .run(knowledge.id);

    // Add to contributor's shared list
    contributor.state.memory.shared.push(id);
    contributor.metrics.knowledgeShared++;
    contributor.updatedAt = now;
    this.db
      .prepare(
        `UPDATE agent_nodes SET state = ?, metrics = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        JSON.stringify(contributor.state),
        JSON.stringify(contributor.metrics),
        contributor.updatedAt,
        contributorId
      );

    // Update swarm metrics
    swarm.metrics.knowledgeEntries++;
    swarm.updatedAt = now;
    this.db
      .prepare(`UPDATE swarms SET metrics = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(swarm.metrics), swarm.updatedAt, contributor.swarmId);

    this.knowledge.set(knowledge.id, knowledge);
    this.emitEvent("knowledge:shared", contributor.swarmId, contributorId, {
      knowledge,
    });

    return knowledge;
  }

  async applyKnowledge(
    agentId: AgentNodeId,
    knowledgeId: KnowledgeId
  ): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");

    const knowledge = this.knowledge.get(knowledgeId);
    if (!knowledge) throw new Error("Knowledge not found");

    // Add to agent's shared memory
    if (!agent.state.memory.shared.includes(knowledgeId)) {
      agent.state.memory.shared.push(knowledgeId);
      agent.updatedAt = Date.now();
      this.db
        .prepare(`UPDATE agent_nodes SET state = ?, updated_at = ? WHERE id = ?`)
        .run(JSON.stringify(agent.state), agent.updatedAt, agentId);
    }

    // Increment usage
    knowledge.usageCount++;
    knowledge.updatedAt = Date.now();
    this.db
      .prepare(`UPDATE shared_knowledge SET usage_count = ?, updated_at = ? WHERE id = ?`)
      .run(knowledge.usageCount, knowledge.updatedAt, knowledgeId);

    this.emitEvent("knowledge:applied", agent.swarmId, agentId, {
      knowledgeId,
    });
  }

  async rateKnowledge(
    knowledgeId: KnowledgeId,
    rating: number
  ): Promise<void> {
    if (!this.db) throw new Error("Not initialized");

    const knowledge = this.knowledge.get(knowledgeId);
    if (!knowledge) throw new Error("Knowledge not found");

    // Average rating
    const totalRatings = knowledge.usageCount || 1;
    knowledge.rating =
      (knowledge.rating * (totalRatings - 1) + rating) / totalRatings;
    knowledge.updatedAt = Date.now();

    this.db
      .prepare(`UPDATE shared_knowledge SET rating = ?, updated_at = ? WHERE id = ?`)
      .run(knowledge.rating, knowledge.updatedAt, knowledgeId);
  }

  async searchKnowledge(
    swarmId: SwarmId,
    query: string,
    type?: KnowledgeType
  ): Promise<SharedKnowledge[]> {
    if (!this.db) throw new Error("Not initialized");

    let results: SharedKnowledge[];

    if (query) {
      const rows = this.db
        .prepare(
          `SELECT k.* FROM shared_knowledge k
           JOIN shared_knowledge_fts fts ON k.rowid = fts.rowid
           WHERE fts.shared_knowledge_fts MATCH ?
           AND k.swarm_id = ?
           ${type ? "AND k.type = ?" : ""}
           ORDER BY rank`
        )
        .all(query, swarmId, ...(type ? [type] : [])) as any[];

      results = rows.map((row) => ({
        id: row.id as KnowledgeId,
        swarmId: row.swarm_id as SwarmId,
        type: row.type,
        content: row.content,
        embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
        metadata: JSON.parse(row.metadata),
        contributorId: row.contributor_id as AgentNodeId,
        usageCount: row.usage_count,
        rating: row.rating,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    } else {
      results = Array.from(this.knowledge.values()).filter(
        (k) => k.swarmId === swarmId && (!type || k.type === type)
      );
    }

    return results;
  }

  async getKnowledge(knowledgeId: KnowledgeId): Promise<SharedKnowledge | null> {
    return this.knowledge.get(knowledgeId) || null;
  }

  async listKnowledge(swarmId: SwarmId): Promise<SharedKnowledge[]> {
    return Array.from(this.knowledge.values()).filter(
      (k) => k.swarmId === swarmId
    );
  }

  // ---------------------------------------------------------------------------
  // STATISTICS & METRICS
  // ---------------------------------------------------------------------------

  async getSwarmStats(swarmId: SwarmId): Promise<SwarmMetrics & { details: any }> {
    const swarm = this.swarms.get(swarmId);
    if (!swarm) throw new Error("Swarm not found");

    const agents = Array.from(this.agents.values()).filter(
      (a) => a.swarmId === swarmId
    );

    const agentsByRole = agents.reduce(
      (acc, a) => {
        acc[a.role] = (acc[a.role] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    const agentsByGeneration = agents.reduce(
      (acc, a) => {
        acc[a.generation] = (acc[a.generation] || 0) + 1;
        return acc;
      },
      {} as Record<number, number>
    );

    const witnesses = Array.from(this.witnesses.values()).filter((w) => {
      const observer = this.agents.get(w.observerId);
      return observer?.swarmId === swarmId;
    });

    return {
      ...swarm.metrics,
      details: {
        agentsByRole,
        agentsByGeneration,
        activeWitnesses: witnesses.filter((w) => w.status === "active").length,
        totalInsights: witnesses.reduce((sum, w) => sum + w.insights.length, 0),
      },
    };
  }

  async getAgentStats(agentId: AgentNodeId): Promise<AgentMetrics & { details: any }> {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error("Agent not found");

    const witnesses = Array.from(this.witnesses.values()).filter(
      (w) => w.observerId === agentId || w.targetId === agentId
    );

    const replications = Array.from(this.replications.values()).filter(
      (r) => r.parentId === agentId
    );

    return {
      ...agent.metrics,
      details: {
        generation: agent.generation,
        childCount: agent.childIds.length,
        pendingTasks: agent.state.pendingTasks.length,
        witnessesObserving: witnesses.filter((w) => w.observerId === agentId)
          .length,
        beingWitnessedBy: witnesses.filter((w) => w.targetId === agentId).length,
        replicationHistory: replications.map((r) => ({
          strategy: r.strategy,
          childId: r.childId,
          createdAt: r.createdAt,
        })),
        memoryUsage: {
          shortTerm: agent.state.memory.shortTerm.length,
          longTerm: agent.state.memory.longTerm.length,
          shared: agent.state.memory.shared.length,
        },
      },
    };
  }

  // ---------------------------------------------------------------------------
  // EVENT EMISSION
  // ---------------------------------------------------------------------------

  private emitEvent(
    type: SwarmEventType,
    swarmId: SwarmId,
    agentId: AgentNodeId | undefined,
    data: unknown
  ): void {
    const event: SwarmEvent = {
      id: randomUUID(),
      type,
      swarmId,
      agentId,
      data,
      timestamp: Date.now(),
    };

    // Store event
    if (this.db) {
      this.db
        .prepare(
          `INSERT INTO swarm_events (id, type, swarm_id, agent_id, data, timestamp)
         VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          event.id,
          event.type,
          event.swarmId,
          event.agentId || null,
          JSON.stringify(event.data),
          event.timestamp
        );
    }

    this.emit("event", event);
    this.emit(type, event);
  }

  // Subscribe to events
  subscribeToEvents(
    callback: (event: SwarmEvent) => void
  ): () => void {
    this.on("event", callback);
    return () => this.off("event", callback);
  }

  // Get recent events
  async getRecentEvents(
    swarmId: SwarmId,
    limit = 100
  ): Promise<SwarmEvent[]> {
    if (!this.db) return [];

    const rows = this.db
      .prepare(
        `SELECT * FROM swarm_events WHERE swarm_id = ? ORDER BY timestamp DESC LIMIT ?`
      )
      .all(swarmId, limit) as any[];

    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      swarmId: row.swarm_id as SwarmId,
      agentId: row.agent_id as AgentNodeId | undefined,
      data: JSON.parse(row.data),
      timestamp: row.timestamp,
    }));
  }
}
