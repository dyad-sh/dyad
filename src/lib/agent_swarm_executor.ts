/**
 * Agent Swarm Executor
 * Wires the Agent Swarm data layer to OpenClaw CNS for actual AI execution.
 *
 * Responsibilities:
 * - Listens to swarm events (task:assigned, agent:started, agent:stopped, agent:terminated)
 * - Executes tasks via OpenClaw CNS when assigned to a running agent
 * - Runs autonomous agent loops (check pending tasks → execute → repeat)
 * - Streams task progress to the renderer via BrowserWindow.webContents
 * - Provides direct execute-task and agent-chat methods for IPC handlers
 */

import log from "electron-log";
import { BrowserWindow } from "electron";
import {
  getAgentSwarm,
  type AgentSwarm,
  type AgentNodeId,
  type SwarmEvent,
  type TaskAssignment,
  type AgentNode,
} from "@/lib/agent_swarm";

const logger = log.scope("swarm_executor");

// =============================================================================
// TYPES
// =============================================================================

export interface TaskProgressEvent {
  agentId: string;
  taskId: string;
  status: "started" | "streaming" | "completed" | "failed";
  chunk?: string;
  output?: string;
  error?: string;
  timestamp: number;
}

export interface AgentChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// =============================================================================
// SWARM EXECUTOR
// =============================================================================

let executorInstance: SwarmExecutor | null = null;

export function getSwarmExecutor(): SwarmExecutor {
  if (!executorInstance) {
    executorInstance = new SwarmExecutor();
  }
  return executorInstance;
}

export class SwarmExecutor {
  private swarm: AgentSwarm | null = null;
  private runningLoops = new Map<string, AbortController>();
  private unsubscribe: (() => void) | null = null;
  private chatHistories = new Map<string, AgentChatMessage[]>();

  // ---------------------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------------------

  async initialize(): Promise<void> {
    this.swarm = getAgentSwarm();

    this.unsubscribe = this.swarm.subscribeToEvents((event) => {
      this.handleEvent(event).catch((err) =>
        logger.error("Error handling swarm event:", err)
      );
    });

    logger.info("Swarm executor initialized");
  }

  async shutdown(): Promise<void> {
    // Abort all running agent loops
    for (const [agentId, controller] of this.runningLoops) {
      logger.info(`Aborting agent loop: ${agentId}`);
      controller.abort();
    }
    this.runningLoops.clear();
    this.chatHistories.clear();

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    this.swarm = null;
    logger.info("Swarm executor shut down");
  }

  // ---------------------------------------------------------------------------
  // EVENT HANDLING
  // ---------------------------------------------------------------------------

  private async handleEvent(event: SwarmEvent): Promise<void> {
    switch (event.type) {
      case "task:assigned": {
        const data = event.data as { task: TaskAssignment };
        if (event.agentId) {
          await this.onTaskAssigned(event.agentId, data.task);
        }
        break;
      }
      case "agent:started": {
        if (event.agentId) {
          this.startAgentLoop(event.agentId);
        }
        break;
      }
      case "agent:stopped":
      case "agent:terminated": {
        if (event.agentId) {
          this.stopAgentLoop(event.agentId);
        }
        break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // TASK EXECUTION
  // ---------------------------------------------------------------------------

  /**
   * Execute a single task for an agent via OpenClaw CNS.
   * Can be called directly (manual trigger) or from the autonomous loop.
   */
  async executeTask(
    agentId: AgentNodeId,
    taskId: string
  ): Promise<string> {
    if (!this.swarm) throw new Error("Executor not initialized");

    const agent = await this.swarm.getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    const task =
      agent.state.pendingTasks.find((t) => t.id === taskId) ??
      (agent.state.currentTask?.id === taskId ? agent.state.currentTask : null);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    // Mark task as running
    task.status = "running";
    task.startedAt = Date.now();

    this.broadcastProgress({
      agentId,
      taskId,
      status: "started",
      timestamp: Date.now(),
    });

    try {
      const { getOpenClawCNS } = await import("@/lib/openclaw_cns");
      const cns = getOpenClawCNS();

      const prompt = this.buildTaskPrompt(agent, task);

      const result = await cns.chat(prompt, {
        systemPrompt: agent.config.systemPrompt || `You are a ${agent.role} agent named "${agent.name}". Execute the assigned task thoroughly and return your result.`,
        preferLocal: true,
      });

      // Complete the task
      await this.swarm.completeTask(agentId, taskId, result);

      this.broadcastProgress({
        agentId,
        taskId,
        status: "completed",
        output: result,
        timestamp: Date.now(),
      });

      logger.info(`Task ${taskId} completed for agent ${agent.name}`);
      return result;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      try {
        await this.swarm.failTask(agentId, taskId, errorMsg);
      } catch {
        // Task may already be in a terminal state
      }

      this.broadcastProgress({
        agentId,
        taskId,
        status: "failed",
        error: errorMsg,
        timestamp: Date.now(),
      });

      logger.error(`Task ${taskId} failed for agent ${agent.name}:`, errorMsg);
      throw new Error(errorMsg);
    }
  }

  /**
   * Get the output of a completed/failed task.
   */
  async getTaskOutput(
    agentId: AgentNodeId,
    taskId: string
  ): Promise<{ output?: unknown; error?: string; status: string }> {
    if (!this.swarm) throw new Error("Executor not initialized");

    const agent = await this.swarm.getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    // Check current task
    if (agent.state.currentTask?.id === taskId) {
      return {
        output: agent.state.currentTask.output,
        error: agent.state.currentTask.error,
        status: agent.state.currentTask.status,
      };
    }

    // Check pending tasks
    const pending = agent.state.pendingTasks.find((t) => t.id === taskId);
    if (pending) {
      return {
        output: pending.output,
        error: pending.error,
        status: pending.status,
      };
    }

    // Task completed/failed and was removed from pending — search memory
    const memEntry = agent.state.memory.shortTerm.find(
      (m) => m.metadata?.taskId === taskId
    );
    if (memEntry) {
      return { output: memEntry.content, status: "completed" };
    }

    throw new Error(`Task not found: ${taskId}`);
  }

  // ---------------------------------------------------------------------------
  // AGENT CHAT
  // ---------------------------------------------------------------------------

  /**
   * Chat with a specific agent — uses the agent's system prompt and role as context.
   */
  async agentChat(
    agentId: AgentNodeId,
    message: string
  ): Promise<string> {
    if (!this.swarm) throw new Error("Executor not initialized");

    const agent = await this.swarm.getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    // Get or create chat history
    let history = this.chatHistories.get(agentId);
    if (!history) {
      history = [];
      this.chatHistories.set(agentId, history);
    }

    // Add user message
    history.push({ role: "user", content: message, timestamp: Date.now() });

    // Build context from history (last 20 messages)
    const recentHistory = history.slice(-20);
    const historyContext = recentHistory
      .map((m) => `${m.role === "user" ? "User" : "Agent"}: ${m.content}`)
      .join("\n");

    const systemPrompt = agent.config.systemPrompt ||
      `You are a ${agent.role} agent named "${agent.name}" in an agent swarm.`;

    const fullPrompt = historyContext
      ? `${historyContext}\nUser: ${message}\nAgent:`
      : message;

    try {
      const { getOpenClawCNS } = await import("@/lib/openclaw_cns");
      const cns = getOpenClawCNS();

      const result = await cns.chat(fullPrompt, {
        systemPrompt,
        preferLocal: true,
      });

      // Save assistant response to history
      history.push({ role: "assistant", content: result, timestamp: Date.now() });

      // Store in agent's short-term memory
      await this.swarm.updateAgent(agentId, {
        name: agent.name, // Required field
      });

      return result;
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      throw new Error(`Chat failed: ${errorMsg}`);
    }
  }

  /**
   * Get chat history for an agent.
   */
  getChatHistory(agentId: string): AgentChatMessage[] {
    return this.chatHistories.get(agentId) ?? [];
  }

  // ---------------------------------------------------------------------------
  // AUTONOMOUS AGENT LOOP
  // ---------------------------------------------------------------------------

  private startAgentLoop(agentId: AgentNodeId): void {
    // Don't start a duplicate loop
    if (this.runningLoops.has(agentId)) return;

    const controller = new AbortController();
    this.runningLoops.set(agentId, controller);

    logger.info(`Starting autonomous loop for agent: ${agentId}`);

    this.runLoop(agentId, controller.signal).catch((err) => {
      if (!controller.signal.aborted) {
        logger.error(`Agent loop error for ${agentId}:`, err);
      }
    });
  }

  private stopAgentLoop(agentId: AgentNodeId): void {
    const controller = this.runningLoops.get(agentId);
    if (controller) {
      controller.abort();
      this.runningLoops.delete(agentId);
      logger.info(`Stopped autonomous loop for agent: ${agentId}`);
    }
  }

  private async runLoop(
    agentId: AgentNodeId,
    signal: AbortSignal
  ): Promise<void> {
    while (!signal.aborted) {
      if (!this.swarm) break;

      const agent = await this.swarm.getAgent(agentId);
      if (!agent || agent.status !== "running") break;

      // Look for pending tasks
      const nextTask = agent.state.pendingTasks.find(
        (t) => t.status === "pending"
      );

      if (nextTask) {
        try {
          await this.executeTask(agentId, nextTask.id);
        } catch {
          // Error already logged in executeTask, continue loop
        }
      }

      // Wait before checking again (avoid tight loop)
      await this.sleep(2000, signal);
    }

    this.runningLoops.delete(agentId);
  }

  // ---------------------------------------------------------------------------
  // EVENT TRIGGERED EXECUTION
  // ---------------------------------------------------------------------------

  private async onTaskAssigned(
    agentId: AgentNodeId,
    task: TaskAssignment
  ): Promise<void> {
    if (!this.swarm) return;

    const agent = await this.swarm.getAgent(agentId);
    if (!agent) return;

    // If the agent is running and has an active autonomous loop, the loop will pick it up.
    // If the agent is idle (not running), execute immediately as a one-shot.
    if (agent.status === "idle" || agent.status === "waiting") {
      try {
        await this.executeTask(agentId, task.id);
      } catch {
        // Error already handled in executeTask
      }
    }
    // If agent is running, the autonomous loop will pick it up on next iteration
  }

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  private buildTaskPrompt(agent: AgentNode, task: TaskAssignment): string {
    const parts: string[] = [];

    parts.push(`## Task Assignment`);
    parts.push(`**Type:** ${task.type}`);
    parts.push(`**Description:** ${task.description}`);

    if (task.input) {
      parts.push(`**Input:** ${typeof task.input === "string" ? task.input : JSON.stringify(task.input)}`);
    }

    if (task.priority > 1) {
      parts.push(`**Priority:** ${task.priority} (high priority)`);
    }

    if (task.deadline) {
      const remaining = task.deadline - Date.now();
      if (remaining > 0) {
        parts.push(`**Deadline:** ${Math.round(remaining / 60000)} minutes remaining`);
      }
    }

    // Add context from agent capabilities
    if (agent.capabilities.length > 0) {
      parts.push(`\n## Your Capabilities`);
      for (const cap of agent.capabilities) {
        parts.push(`- ${cap.name}: ${cap.description} (proficiency: ${Math.round(cap.proficiency * 100)}%)`);
      }
    }

    // Add recent memory context
    const recentMemory = agent.state.memory.shortTerm.slice(-5);
    if (recentMemory.length > 0) {
      parts.push(`\n## Recent Context`);
      for (const mem of recentMemory) {
        parts.push(`- [${mem.type}] ${mem.content}`);
      }
    }

    parts.push(`\nExecute this task and provide your complete result.`);

    return parts.join("\n");
  }

  private broadcastProgress(progress: TaskProgressEvent): void {
    try {
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send("agent-swarm:task-progress", progress);
        }
      }
    } catch {
      // Windows may be closed
    }
  }

  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }
}
