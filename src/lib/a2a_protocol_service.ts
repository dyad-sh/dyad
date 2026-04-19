/**
 * Agent-to-Agent (A2A) Protocol Service
 * 
 * The nervous system of the agentic web. Enables agents to:
 * - Register themselves in a decentralized registry
 * - Discover other agents by capability, price, reputation
 * - Negotiate and execute tasks across agent boundaries
 * - Exchange MCP tools between agents
 * - Handle payments and verification
 * 
 * Protocol: libp2p for transport, DIDs for identity, JOY for payments.
 */

import { v4 as uuidv4 } from "uuid";
import * as crypto from "crypto";
import log from "electron-log";
import * as fs from "fs-extra";
import * as path from "path";
import { getUserDataPath } from "@/paths/paths";
import { EventEmitter } from "events";

import type {
  AgentCard,
  AgentCapability,
  AgentCapabilityCategory,
  AgentPricing,
  AgentEndpoint,
  AgentRegistryEntry,
  AgentSearchQuery,
  AgentSearchResult,
  A2AMessage,
  A2AMessageType,
  A2APayload,
  A2ATask,
  A2ATaskStatus,
  TaskRequestPayload,
  TaskResponsePayload,
  TaskStatusPayload,
  A2ANetworkStats,
} from "@/types/a2a_types";

const logger = log.scope("a2a-protocol");

// =============================================================================
// A2A PROTOCOL SERVICE
// =============================================================================

class A2AProtocolService extends EventEmitter {
  private dataDir: string;
  private registry: Map<string, AgentRegistryEntry> = new Map();
  private tasks: Map<string, A2ATask> = new Map();
  private messageQueue: Map<string, A2AMessage[]> = new Map(); // agentId -> messages
  private myAgents: Map<string, AgentCard> = new Map(); // Local agents registered
  private initialized = false;

  constructor() {
    super();
    this.dataDir = path.join(getUserDataPath(), "a2a");
  }

  // ===========================================================================
  // LIFECYCLE
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;
    logger.info("Initializing A2A protocol service...");

    await fs.ensureDir(this.dataDir);
    await fs.ensureDir(path.join(this.dataDir, "registry"));
    await fs.ensureDir(path.join(this.dataDir, "tasks"));
    await fs.ensureDir(path.join(this.dataDir, "messages"));
    await fs.ensureDir(path.join(this.dataDir, "my-agents"));

    await this.loadRegistry();
    await this.loadTasks();
    await this.loadMyAgents();

    this.initialized = true;
    logger.info("A2A protocol service initialized", {
      registrySize: this.registry.size,
      activeTasks: this.tasks.size,
      myAgents: this.myAgents.size,
    });
  }

  // ===========================================================================
  // AGENT REGISTRATION
  // ===========================================================================

  /**
   * Register a local agent to the network.
   */
  async registerAgent(params: {
    name: string;
    description: string;
    ownerDid: string;
    capabilities: AgentCapability[];
    pricing: AgentPricing[];
    endpoints: AgentEndpoint[];
    version?: string;
    avatarUrl?: string;
  }): Promise<AgentCard> {
    await this.ensureInit();

    const agentId = `did:joy:agent:${crypto.createHash("sha256").update(params.name + params.ownerDid + Date.now()).digest("hex").slice(0, 24)}`;

    const card: AgentCard = {
      agentId,
      ownerDid: params.ownerDid,
      name: params.name,
      description: params.description,
      version: params.version ?? "1.0.0",
      avatarUrl: params.avatarUrl,
      capabilities: params.capabilities,
      pricing: params.pricing,
      mcpTools: [],
      schemas: {},
      endpoints: params.endpoints,
      authMethods: ["did-auth"],
      reputationScore: 0,
      trustTier: "newcomer",
      totalTasksCompleted: 0,
      avgResponseMs: 0,
      uptimePercent: 100,
      updatedAt: Date.now(),
      registeredAt: Date.now(),
      signature: this.signCard(agentId, params.ownerDid),
    };

    // Store locally
    this.myAgents.set(agentId, card);
    await fs.writeJson(path.join(this.dataDir, "my-agents", `${this.sanitizeId(agentId)}.json`), card, { spaces: 2 });

    // Add to registry
    const entry: AgentRegistryEntry = {
      agentId,
      card,
      tags: this.extractTags(card),
      categories: card.capabilities.map((c) => c.category),
      network: "joy-network",
      online: true,
      lastSeen: Date.now(),
      registeredAt: Date.now(),
    };
    this.registry.set(agentId, entry);
    await this.persistRegistryEntry(entry);

    this.emit("agent:registered", card);
    logger.info("Agent registered", { agentId, name: card.name, capabilities: card.capabilities.length });
    return card;
  }

  /**
   * Update an existing agent's card.
   */
  async updateAgent(agentId: string, updates: Partial<AgentCard>): Promise<AgentCard> {
    await this.ensureInit();

    const card = this.myAgents.get(agentId);
    if (!card) throw new Error(`Agent not found in local registry: ${agentId}`);

    Object.assign(card, updates, { updatedAt: Date.now() });
    this.myAgents.set(agentId, card);
    await fs.writeJson(path.join(this.dataDir, "my-agents", `${this.sanitizeId(agentId)}.json`), card, { spaces: 2 });

    // Update registry
    const entry = this.registry.get(agentId);
    if (entry) {
      entry.card = card;
      entry.tags = this.extractTags(card);
      entry.categories = card.capabilities.map((c) => c.category);
      await this.persistRegistryEntry(entry);
    }

    this.emit("agent:updated", card);
    return card;
  }

  /**
   * Deregister an agent from the network.
   */
  async deregisterAgent(agentId: string): Promise<void> {
    await this.ensureInit();

    this.myAgents.delete(agentId);
    this.registry.delete(agentId);

    const myAgentPath = path.join(this.dataDir, "my-agents", `${this.sanitizeId(agentId)}.json`);
    const registryPath = path.join(this.dataDir, "registry", `${this.sanitizeId(agentId)}.json`);
    await fs.remove(myAgentPath).catch(() => {});
    await fs.remove(registryPath).catch(() => {});

    this.emit("agent:deregistered", agentId);
    logger.info("Agent deregistered", { agentId });
  }

  /**
   * Get a specific agent's card.
   */
  async getAgent(agentId: string): Promise<AgentCard | null> {
    await this.ensureInit();
    const entry = this.registry.get(agentId);
    return entry?.card ?? null;
  }

  /**
   * Get all locally registered agents.
   */
  async getMyAgents(): Promise<AgentCard[]> {
    await this.ensureInit();
    return Array.from(this.myAgents.values());
  }

  // ===========================================================================
  // AGENT DISCOVERY
  // ===========================================================================

  /**
   * Search the agent registry with filters.
   */
  async searchAgents(query: AgentSearchQuery): Promise<AgentSearchResult> {
    await this.ensureInit();

    let results = Array.from(this.registry.values());

    // Text search
    if (query.query) {
      const q = query.query.toLowerCase();
      results = results.filter((r) =>
        r.card.name.toLowerCase().includes(q) ||
        r.card.description.toLowerCase().includes(q) ||
        r.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    // Category filter
    if (query.categories?.length) {
      results = results.filter((r) =>
        r.categories.some((c) => query.categories!.includes(c)),
      );
    }

    // Pricing model filter
    if (query.pricingModel?.length) {
      results = results.filter((r) =>
        r.card.pricing.some((p) => query.pricingModel!.includes(p.model)),
      );
    }

    // Reputation filter
    if (query.minReputation !== undefined) {
      results = results.filter((r) => r.card.reputationScore >= query.minReputation!);
    }

    // Online filter
    if (query.onlineOnly) {
      results = results.filter((r) => r.online);
    }

    // Sort
    const sortBy = query.sortBy ?? "reputation";
    const sortDir = query.sortDir ?? "desc";
    results.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case "reputation": cmp = a.card.reputationScore - b.card.reputationScore; break;
        case "latency": cmp = a.card.avgResponseMs - b.card.avgResponseMs; break;
        case "uptime": cmp = a.card.uptimePercent - b.card.uptimePercent; break;
        case "tasks_completed": cmp = a.card.totalTasksCompleted - b.card.totalTasksCompleted; break;
        case "newest": cmp = a.registeredAt - b.registeredAt; break;
        default: cmp = 0;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });

    const total = results.length;
    const offset = query.offset ?? 0;
    const limit = query.limit ?? 20;
    results = results.slice(offset, offset + limit);

    return { agents: results, total, offset, limit };
  }

  /**
   * Find agents by capability.
   */
  async findAgentsByCapability(category: AgentCapabilityCategory, maxPrice?: string): Promise<AgentRegistryEntry[]> {
    const result = await this.searchAgents({
      categories: [category],
      onlineOnly: true,
      sortBy: "reputation",
      sortDir: "desc",
      limit: 50,
    });
    return result.agents;
  }

  // ===========================================================================
  // TASK MANAGEMENT (A2A Work)
  // ===========================================================================

  /**
   * Create a new task request to another agent.
   */
  async createTask(
    requesterId: string,
    executorId: string,
    capabilityId: string,
    input: Record<string, unknown>,
    options?: { maxBudget?: string; currency?: string; deadlineMs?: number },
  ): Promise<A2ATask> {
    await this.ensureInit();

    const task: A2ATask = {
      id: uuidv4(),
      threadId: uuidv4(),
      requesterId,
      executorId,
      capabilityId,
      input,
      agreedPrice: undefined,
      currency: options?.currency ?? "JOY",
      paymentTxHash: undefined,
      paymentStatus: "none",
      status: "created",
      progress: 0,
      verified: false,
      createdAt: Date.now(),
      messageCount: 0,
    };

    this.tasks.set(task.id, task);
    await this.persistTask(task);

    // Send task request message
    const message = this.createMessage(
      "task-request",
      requesterId,
      executorId,
      task.threadId,
      {
        kind: "task-request",
        taskId: task.id,
        capabilityId,
        input,
        maxBudget: options?.maxBudget,
        currency: options?.currency,
        deadlineMs: options?.deadlineMs,
      } as TaskRequestPayload,
    );

    await this.sendMessage(message);
    this.emit("task:created", task);
    logger.info("Task created", { taskId: task.id, requester: requesterId, executor: executorId });
    return task;
  }

  /**
   * Accept a task as the executor.
   */
  async acceptTask(taskId: string, agreedPrice?: string): Promise<A2ATask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = "accepted";
    task.agreedPrice = agreedPrice;
    task.updatedAt = Date.now();
    await this.persistTask(task);

    const message = this.createMessage(
      "task-response",
      task.executorId,
      task.requesterId,
      task.threadId,
      {
        kind: "task-response",
        taskId,
        status: "accepted",
        cost: agreedPrice,
        currency: task.currency,
      } as TaskResponsePayload,
    );
    await this.sendMessage(message);

    this.emit("task:accepted", task);
    return task;
  }

  /**
   * Reject a task as the executor.
   */
  async rejectTask(taskId: string, reason?: string): Promise<A2ATask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = "cancelled";
    await this.persistTask(task);

    const message = this.createMessage(
      "task-response",
      task.executorId,
      task.requesterId,
      task.threadId,
      {
        kind: "task-response",
        taskId,
        status: "rejected",
        rejectionReason: reason,
      } as TaskResponsePayload,
    );
    await this.sendMessage(message);

    this.emit("task:rejected", task);
    return task;
  }

  /**
   * Update task progress.
   */
  async updateTaskProgress(taskId: string, progress: number, partialOutput?: Record<string, unknown>): Promise<A2ATask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = "running";
    task.progress = progress;
    if (!task.startedAt) task.startedAt = Date.now();
    await this.persistTask(task);

    const message = this.createMessage(
      "task-status",
      task.executorId,
      task.requesterId,
      task.threadId,
      {
        kind: "task-status",
        taskId,
        status: "running",
        progress,
        partialOutput,
      } as TaskStatusPayload,
    );
    await this.sendMessage(message);

    this.emit("task:progress", task);
    return task;
  }

  /**
   * Complete a task with output.
   */
  async completeTask(
    taskId: string,
    output: Record<string, unknown>,
    usage?: { inputTokens: number; outputTokens: number; computeMs: number },
  ): Promise<A2ATask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = "completed";
    task.output = output;
    task.progress = 100;
    task.completedAt = Date.now();
    await this.persistTask(task);

    const message = this.createMessage(
      "task-response",
      task.executorId,
      task.requesterId,
      task.threadId,
      {
        kind: "task-response",
        taskId,
        status: "completed",
        output,
        usage,
        cost: task.agreedPrice,
        currency: task.currency,
      } as TaskResponsePayload,
    );
    await this.sendMessage(message);

    // Update executor stats
    const executor = this.registry.get(task.executorId);
    if (executor) {
      executor.card.totalTasksCompleted++;
      if (task.startedAt && task.completedAt) {
        const latency = task.completedAt - task.startedAt;
        executor.card.avgResponseMs = Math.round(
          (executor.card.avgResponseMs * (executor.card.totalTasksCompleted - 1) + latency) / executor.card.totalTasksCompleted,
        );
      }
      await this.persistRegistryEntry(executor);
    }

    this.emit("task:completed", task);
    logger.info("Task completed", { taskId, executorId: task.executorId });
    return task;
  }

  /**
   * Fail a task.
   */
  async failTask(taskId: string, reason: string): Promise<A2ATask> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    task.status = "failed";
    task.completedAt = Date.now();
    await this.persistTask(task);

    const message = this.createMessage(
      "task-response",
      task.executorId,
      task.requesterId,
      task.threadId,
      {
        kind: "task-response",
        taskId,
        status: "failed",
        failureReason: reason,
      } as TaskResponsePayload,
    );
    await this.sendMessage(message);

    this.emit("task:failed", task);
    return task;
  }

  /**
   * Get all tasks, optionally filtered.
   */
  async getTasks(filters?: {
    requesterId?: string;
    executorId?: string;
    status?: A2ATaskStatus;
  }): Promise<A2ATask[]> {
    await this.ensureInit();
    let all = Array.from(this.tasks.values());

    if (filters?.requesterId) all = all.filter((t) => t.requesterId === filters.requesterId);
    if (filters?.executorId) all = all.filter((t) => t.executorId === filters.executorId);
    if (filters?.status) all = all.filter((t) => t.status === filters.status);

    return all.sort((a, b) => b.createdAt - a.createdAt);
  }

  async getTask(taskId: string): Promise<A2ATask | null> {
    await this.ensureInit();
    return this.tasks.get(taskId) ?? null;
  }

  // ===========================================================================
  // MESSAGING
  // ===========================================================================

  async sendMessage(message: A2AMessage): Promise<void> {
    // Queue message for recipient
    if (!this.messageQueue.has(message.to)) {
      this.messageQueue.set(message.to, []);
    }
    this.messageQueue.get(message.to)!.push(message);

    // Persist
    const msgDir = path.join(this.dataDir, "messages", this.sanitizeId(message.to));
    await fs.ensureDir(msgDir);
    await fs.writeJson(path.join(msgDir, `${message.id}.json`), message, { spaces: 2 });

    // Update task message count
    const task = this.tasks.get(
      (message.payload as any)?.taskId ?? "",
    );
    if (task) {
      task.messageCount++;
      await this.persistTask(task);
    }

    this.emit("message:sent", message);
  }

  async getMessages(agentId: string, limit = 50): Promise<A2AMessage[]> {
    const queue = this.messageQueue.get(agentId) ?? [];
    return queue.slice(-limit);
  }

  async getThreadMessages(threadId: string): Promise<A2AMessage[]> {
    const allMessages: A2AMessage[] = [];
    for (const msgs of this.messageQueue.values()) {
      allMessages.push(...msgs.filter((m) => m.threadId === threadId));
    }
    return allMessages.sort((a, b) => a.timestamp - b.timestamp);
  }

  // ===========================================================================
  // NETWORK STATS
  // ===========================================================================

  async getNetworkStats(): Promise<A2ANetworkStats> {
    await this.ensureInit();

    const allTasks = Array.from(this.tasks.values());
    const completedTasks = allTasks.filter((t) => t.status === "completed");
    const activeTasks = allTasks.filter((t) => ["running", "accepted", "negotiating"].includes(t.status));

    let totalLatency = 0;
    let latencyCount = 0;
    for (const t of completedTasks) {
      if (t.startedAt && t.completedAt) {
        totalLatency += t.completedAt - t.startedAt;
        latencyCount++;
      }
    }

    // Category distribution
    const catCounts = new Map<AgentCapabilityCategory, number>();
    for (const entry of this.registry.values()) {
      for (const cat of entry.categories) {
        catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
      }
    }

    return {
      totalRegisteredAgents: this.registry.size,
      onlineAgents: Array.from(this.registry.values()).filter((r) => r.online).length,
      totalTasksCompleted: completedTasks.length,
      totalValueTransacted: "0", // Would aggregate from payment records
      avgTaskLatencyMs: latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0,
      activeTasksNow: activeTasks.length,
      topCategories: Array.from(catCounts.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private createMessage(
    type: A2AMessageType,
    from: string,
    to: string,
    threadId: string,
    payload: A2APayload,
    inReplyTo?: string,
  ): A2AMessage {
    return {
      id: uuidv4(),
      type,
      from,
      to,
      threadId,
      inReplyTo,
      payload,
      signature: this.signMessage(from, payload),
      timestamp: Date.now(),
      priority: "normal",
    };
  }

  private signCard(agentId: string, ownerDid: string): string {
    return crypto.createHash("sha256").update(`${agentId}:${ownerDid}:${Date.now()}`).digest("hex");
  }

  private signMessage(from: string, payload: A2APayload): string {
    return crypto.createHash("sha256").update(`${from}:${JSON.stringify(payload)}`).digest("hex");
  }

  private extractTags(card: AgentCard): string[] {
    const tags: string[] = [];
    tags.push(card.name.toLowerCase());
    tags.push(...card.capabilities.map((c) => c.category));
    tags.push(...card.capabilities.map((c) => c.name.toLowerCase()));

    // Extract keywords from description
    const words = card.description.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    tags.push(...words.slice(0, 10));

    return [...new Set(tags)];
  }

  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  private async persistRegistryEntry(entry: AgentRegistryEntry): Promise<void> {
    const p = path.join(this.dataDir, "registry", `${this.sanitizeId(entry.agentId)}.json`);
    await fs.writeJson(p, entry, { spaces: 2 });
  }

  private async persistTask(task: A2ATask): Promise<void> {
    const p = path.join(this.dataDir, "tasks", `${task.id}.json`);
    await fs.writeJson(p, task, { spaces: 2 });
  }

  private async loadRegistry(): Promise<void> {
    const dir = path.join(this.dataDir, "registry");
    if (!(await fs.pathExists(dir))) return;
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const entry: AgentRegistryEntry = await fs.readJson(path.join(dir, f));
        this.registry.set(entry.agentId, entry);
      } catch { /* skip corrupt */ }
    }
  }

  private async loadTasks(): Promise<void> {
    const dir = path.join(this.dataDir, "tasks");
    if (!(await fs.pathExists(dir))) return;
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const task: A2ATask = await fs.readJson(path.join(dir, f));
        this.tasks.set(task.id, task);
      } catch { /* skip corrupt */ }
    }
  }

  private async loadMyAgents(): Promise<void> {
    const dir = path.join(this.dataDir, "my-agents");
    if (!(await fs.pathExists(dir))) return;
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const card: AgentCard = await fs.readJson(path.join(dir, f));
        this.myAgents.set(card.agentId, card);
      } catch { /* skip corrupt */ }
    }
  }

  private async ensureInit(): Promise<void> {
    if (!this.initialized) await this.initialize();
  }
}

// Singleton
export const a2aProtocolService = new A2AProtocolService();
export { A2AProtocolService };
