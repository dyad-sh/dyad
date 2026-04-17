/**
 * Agent Orchestrator Engine
 *
 * The core engine that unifies all agent subsystems into a single
 * autonomous orchestration layer.
 *
 * Flow:
 * 1. User input (voice / text / NLP) → OrchestratorInput
 * 2. Meta-agent analyzes input → ParsedIntent
 * 3. Task decomposition → TaskNode[] graph
 * 4. Agent creation via Swarm / Autonomous / Factory
 * 5. Execution via OpenClaw CNS (local Ollama or cloud)
 * 6. Monitoring, checkpointing, result aggregation
 * 7. Output + artifacts returned to user
 */

import { EventEmitter } from "events";
import * as fs from "fs-extra";
import * as path from "path";
import { app } from "electron";
import { v4 as uuidv4 } from "uuid";
import log from "electron-log";

import { getAgentSwarm, type SwarmId } from "@/lib/agent_swarm";
import { getAutonomousAgentSystem } from "@/lib/autonomous_agent";
import { getOpenClawCNS } from "@/lib/openclaw_cns";
import { getOpenClawOllamaBridge } from "@/lib/openclaw_ollama_bridge";
import { voiceAssistant } from "@/lib/voice_assistant";

import {
  AGENT_TEMPLATES,
  DEFAULT_EXECUTION_CONFIG,
  DEFAULT_COMMUNICATION_CONFIG,
  DEFAULT_LONG_TERM_CONFIG,
  DEFAULT_AGENT_CREATION_CONFIG,
} from "@/types/agent_orchestrator";
import type {
  OrchestrationId,
  MetaAgentId,
  TaskNodeId,
  PlanId,
  ExecutionTraceId,
  OrchestratorInput,
  ParsedIntent,
  ExecutionConfig,
  AgentCapabilityType,
  AgentCapability,
  MetaAgent,
  MetaAgentStatus,
  AgentTemplate,
  AgentCreationConfig,
  MetaAgentStats,
  TaskNode,
  TaskNodeStatus,
  TaskPriority,
  TaskComplexity,
  OrchestrationPlan,
  PlanStatus,
  AgentAssignment,
  Orchestration,
  OrchestrationStatus,
  OrchestrationResult,
  OrchestrationResultStats,
  OrchestrationArtifact,
  ExecutionTraceEntry,
  CommunicationConfig,
  LongTermTaskConfig,
  TaskCheckpoint,
  SubmitTaskRequest,
  SubmitTaskResponse,
  OrchestratorDashboard,
  SystemStatus,
  OrchestratorEvent,
  OrchestratorEventType,
} from "@/types/agent_orchestrator";

const logger = log.scope("orchestrator_engine");

// =============================================================================
// ENGINE STATE
// =============================================================================

let engineInstance: AgentOrchestratorEngine | null = null;

export function getOrchestratorEngine(): AgentOrchestratorEngine {
  if (!engineInstance) {
    engineInstance = new AgentOrchestratorEngine();
  }
  return engineInstance;
}

// =============================================================================
// ENGINE CLASS
// =============================================================================

export class AgentOrchestratorEngine extends EventEmitter {
  private initialized = false;
  private dataDir: string;

  // Core state
  private metaAgent: MetaAgent | null = null;
  private orchestrations: Map<string, Orchestration> = new Map();
  private plans: Map<string, OrchestrationPlan> = new Map();
  private checkpoints: Map<string, TaskCheckpoint[]> = new Map();
  private executionTimers: Map<string, NodeJS.Timeout> = new Map();

  // Default configs
  private executionConfig: ExecutionConfig;
  private communicationConfig: CommunicationConfig;
  private longTermConfig: LongTermTaskConfig;

  constructor() {
    super();
    this.dataDir = path.join(app.getPath("userData"), "agent_orchestrator");
    this.executionConfig = { ...DEFAULT_EXECUTION_CONFIG };
    this.communicationConfig = { ...DEFAULT_COMMUNICATION_CONFIG };
    this.longTermConfig = { ...DEFAULT_LONG_TERM_CONFIG };
  }

  // ===========================================================================
  // INITIALIZATION
  // ===========================================================================

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info("🧠 Initializing Agent Orchestrator Engine...");

    // Create storage directories
    await fs.ensureDir(this.dataDir);
    await fs.ensureDir(path.join(this.dataDir, "orchestrations"));
    await fs.ensureDir(path.join(this.dataDir, "checkpoints"));
    await fs.ensureDir(path.join(this.dataDir, "artifacts"));

    // Load or create the meta-agent
    await this.loadOrCreateMetaAgent();

    // Load persisted orchestrations
    await this.loadOrchestrations();

    // Initialize subsystems (best-effort — they may already be initialized)
    await this.initializeSubsystems();

    this.initialized = true;
    logger.info("🧠 Agent Orchestrator Engine initialized");
    this.emitEvent("meta-agent:created", {});
  }

  async shutdown(): Promise<void> {
    if (!this.initialized) return;

    logger.info("🧠 Shutting down Agent Orchestrator Engine...");

    // Cancel running orchestrations
    for (const [id, orch] of this.orchestrations) {
      if (orch.status === "executing" || orch.status === "monitoring") {
        await this.cancelOrchestration(id as OrchestrationId);
      }
    }

    // Clear timers
    for (const timer of this.executionTimers.values()) {
      clearTimeout(timer);
    }
    this.executionTimers.clear();

    // Save state
    await this.saveMetaAgent();
    await this.saveAllOrchestrations();

    this.initialized = false;
    logger.info("🧠 Agent Orchestrator Engine shut down");
  }

  // ===========================================================================
  // META-AGENT MANAGEMENT
  // ===========================================================================

  getMetaAgent(): MetaAgent | null {
    return this.metaAgent;
  }

  private async loadOrCreateMetaAgent(): Promise<void> {
    const metaPath = path.join(this.dataDir, "meta_agent.json");

    if (await fs.pathExists(metaPath)) {
      try {
        this.metaAgent = await fs.readJson(metaPath);
        logger.info(`Loaded meta-agent: ${this.metaAgent!.name}`);
        return;
      } catch (err) {
        logger.warn("Failed to load meta-agent, creating new one:", err);
      }
    }

    // Create default meta-agent
    this.metaAgent = {
      id: uuidv4() as MetaAgentId,
      name: "JoyCreate Orchestrator",
      description:
        "Meta-agent that analyzes user requests, decomposes tasks, creates specialized agents, and orchestrates their execution.",
      status: "idle",
      capabilities: [
        { type: "planning", proficiency: 0.95, description: "Task decomposition and planning" },
        { type: "meta_agent_creation", proficiency: 0.9, description: "Creating specialized agents" },
        { type: "task_management", proficiency: 0.9, description: "Managing multi-agent task execution" },
        { type: "communication", proficiency: 0.85, description: "Inter-agent and user communication" },
      ],
      templates: [...AGENT_TEMPLATES],
      orchestrationHistory: [],
      creationConfig: { ...DEFAULT_AGENT_CREATION_CONFIG },
      stats: {
        totalOrchestrations: 0,
        agentsCreated: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        averageCompletionTimeMs: 0,
        successRate: 1,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await this.saveMetaAgent();
    logger.info("Created new meta-agent");
  }

  private async saveMetaAgent(): Promise<void> {
    if (!this.metaAgent) return;
    const metaPath = path.join(this.dataDir, "meta_agent.json");
    await fs.writeJson(metaPath, this.metaAgent, { spaces: 2 });
  }

  // ===========================================================================
  // SUBSYSTEM INITIALIZATION (best-effort)
  // ===========================================================================

  private async initializeSubsystems(): Promise<void> {
    const results: Record<string, boolean> = {};

    // Agent Swarm
    try {
      const swarm = getAgentSwarm();
      await swarm.initialize();
      results.agentSwarm = true;
    } catch (err) {
      logger.warn("Agent Swarm initialization skipped:", err);
      results.agentSwarm = false;
    }

    // Autonomous Agent System
    try {
      const autonomous = getAutonomousAgentSystem();
      await autonomous.initialize();
      results.autonomousAgent = true;
    } catch (err) {
      logger.warn("Autonomous Agent System initialization skipped:", err);
      results.autonomousAgent = false;
    }

    // OpenClaw CNS
    try {
      const cns = getOpenClawCNS();
      await cns.initialize();
      results.openclawCns = true;
    } catch (err) {
      logger.warn("OpenClaw CNS initialization skipped:", err);
      results.openclawCns = false;
    }

    logger.info("Subsystem initialization results:", results);
  }

  // ===========================================================================
  // CORE API — SUBMIT TASK
  // ===========================================================================

  async submitTask(request: SubmitTaskRequest): Promise<SubmitTaskResponse> {
    if (!this.initialized || !this.metaAgent) {
      throw new Error("Orchestrator engine not initialized");
    }

    const orchestrationId = uuidv4() as OrchestrationId;

    // Merge configs
    const execConfig: ExecutionConfig = {
      ...this.executionConfig,
      ...(request.executionConfig ?? {}),
    };
    const commConfig: CommunicationConfig = {
      ...this.communicationConfig,
      ...(request.communicationConfig ?? {}),
    };

    // Create orchestration
    const orchestration: Orchestration = {
      id: orchestrationId,
      metaAgentId: this.metaAgent.id,
      input: request.input,
      status: "received",
      executionConfig: execConfig,
      trace: [],
      progress: 0,
      createdAt: new Date().toISOString(),
    };

    this.orchestrations.set(orchestrationId, orchestration);
    this.addTrace(orchestration, "info", "orchestrator", "Task received", { input: request.input });
    this.emitEvent("orchestration:started", { orchestrationId });

    // Handle voice input → transcribe first
    if (request.input.modality === "voice" && request.input.audioPath) {
      await this.handleVoiceInput(orchestration);
    }

    // Start async orchestration pipeline
    this.runOrchestrationPipeline(orchestration, commConfig, request.longTermConfig).catch((err) => {
      logger.error(`Orchestration ${orchestrationId} pipeline failed:`, err);
      orchestration.status = "failed";
      orchestration.error = err.message;
      this.emitEvent("orchestration:failed", { orchestrationId, error: err.message });
    });

    return {
      orchestrationId,
      status: orchestration.status,
    };
  }

  // ===========================================================================
  // ORCHESTRATION PIPELINE
  // ===========================================================================

  private async runOrchestrationPipeline(
    orchestration: Orchestration,
    commConfig: CommunicationConfig,
    longTermConfig?: Partial<LongTermTaskConfig>,
  ): Promise<void> {
    try {
      // Step 1: Parse input with NLP
      orchestration.status = "parsing_input";
      this.addTrace(orchestration, "info", "nlp", "Parsing user input...");
      const intent = await this.parseInput(orchestration.input, orchestration.executionConfig);
      orchestration.input.intent = intent;
      orchestration.progress = 10;

      // Step 2: Decompose into tasks
      orchestration.status = "decomposing_task";
      this.addTrace(orchestration, "info", "decomposer", "Decomposing task...");
      const plan = await this.decomposeTask(orchestration);
      orchestration.plan = plan;
      this.plans.set(plan.id, plan);
      orchestration.progress = 25;
      this.emitEvent("orchestration:plan:created", {
        orchestrationId: orchestration.id,
        planId: plan.id,
        taskCount: plan.tasks.length,
      });

      // Step 3: Create agents
      orchestration.status = "creating_agents";
      this.addTrace(orchestration, "info", "agent_factory", "Creating agents for tasks...");
      await this.createAgentsForPlan(orchestration, plan);
      orchestration.progress = 40;
      this.emitEvent("orchestration:agents:created", {
        orchestrationId: orchestration.id,
        agentCount: plan.agentAssignments.length,
      });

      // Step 4: Execute tasks
      orchestration.status = "executing";
      orchestration.startedAt = new Date().toISOString();
      this.addTrace(orchestration, "info", "executor", "Executing task graph...");
      await this.executePlan(orchestration, plan, commConfig, longTermConfig);

      // Step 5: Aggregate results
      orchestration.status = "aggregating_results";
      this.addTrace(orchestration, "info", "aggregator", "Aggregating results...");
      const results = await this.aggregateResults(orchestration, plan);
      orchestration.results = results;

      // Complete
      orchestration.status = "completed";
      orchestration.completedAt = new Date().toISOString();
      orchestration.progress = 100;
      orchestration.durationMs = new Date(orchestration.completedAt).getTime() -
        new Date(orchestration.createdAt).getTime();

      // Update meta-agent stats
      this.updateMetaAgentStats(orchestration);
      await this.saveOrchestration(orchestration);
      await this.saveMetaAgent();

      this.addTrace(orchestration, "info", "orchestrator", "Orchestration completed", {
        durationMs: orchestration.durationMs,
        results: results.stats,
      });
      this.emitEvent("orchestration:completed", {
        orchestrationId: orchestration.id,
        stats: results.stats,
      });
    } catch (err: any) {
      orchestration.status = "failed";
      orchestration.error = err.message;
      orchestration.completedAt = new Date().toISOString();
      orchestration.durationMs = new Date(orchestration.completedAt).getTime() -
        new Date(orchestration.createdAt).getTime();

      this.updateMetaAgentStats(orchestration);
      await this.saveOrchestration(orchestration);
      await this.saveMetaAgent();

      this.addTrace(orchestration, "error", "orchestrator", `Orchestration failed: ${err.message}`);
      this.emitEvent("orchestration:failed", {
        orchestrationId: orchestration.id,
        error: err.message,
      });
      throw err;
    }
  }

  // ===========================================================================
  // VOICE INPUT HANDLING
  // ===========================================================================

  private async handleVoiceInput(orchestration: Orchestration): Promise<void> {
    try {
      this.addTrace(orchestration, "info", "voice", "Transcribing voice input...");
      const result = await voiceAssistant.transcribe(orchestration.input.audioPath!);
      orchestration.input.text = result.text;
      this.addTrace(orchestration, "info", "voice", `Transcribed: "${result.text}"`);
      this.emitEvent("voice:transcribed", {
        orchestrationId: orchestration.id,
        text: result.text,
      });
    } catch (err: any) {
      logger.warn("Voice transcription failed, using raw text:", err);
      this.addTrace(orchestration, "warn", "voice", `Transcription failed: ${err.message}`);
    }
  }

  // ===========================================================================
  // NLP PARSING — Uses OpenClaw CNS / Ollama to parse intent
  // ===========================================================================

  private async parseInput(input: OrchestratorInput, config: ExecutionConfig): Promise<ParsedIntent> {
    const parsePrompt = `Analyze the following user request and extract the intent.
Return a JSON object with:
- "action": the primary action the user wants (e.g., "build_app", "research", "write_code", "analyze_data", "deploy", "create_agent")
- "entities": array of objects with { "type", "value", "start", "end", "confidence" }
- "confidence": overall confidence 0-1
- "rawText": the original text

User request: "${input.text}"

Respond ONLY with valid JSON, no markdown formatting.`;

    try {
      const cns = getOpenClawCNS();
      const response = await cns.chat(parsePrompt, {
        preferLocal: config.preferLocal,
      });

      const parsed = JSON.parse(typeof response === "string" ? response : (response as any).content || "{}");
      return {
        action: parsed.action || "unknown",
        entities: parsed.entities || [],
        confidence: parsed.confidence || 0.5,
        rawText: input.text,
      };
    } catch (err) {
      logger.warn("NLP parsing failed, using fallback:", err);
      return {
        action: "general_task",
        entities: [],
        confidence: 0.3,
        rawText: input.text,
      };
    }
  }

  // ===========================================================================
  // TASK DECOMPOSITION — AI-powered task graph creation
  // ===========================================================================

  private async decomposeTask(orchestration: Orchestration): Promise<OrchestrationPlan> {
    const input = orchestration.input;
    const planId = uuidv4() as PlanId;

    // Fetch available skills to include in the LLM prompt
    let skillsSection = "";
    try {
      const { listSkills } = await import("@/lib/skill_engine");
      const enabledSkills = await listSkills({ enabled: true, limit: 50 });
      if (enabledSkills.length > 0) {
        skillsSection = `\nAvailable skills (can fulfill tasks directly without spawning an agent):\n${enabledSkills.map((s) => `- skill_${s.id}: ${s.name} — ${s.description} (${s.category})`).join("\n")}\n`;
      }
    } catch {
      // skill engine not available, continue without skills
    }

    const decomposePrompt = `You are a task decomposition engine. Given a user request, break it down into a directed acyclic graph of sub-tasks.

User request: "${input.text}"
${input.intent ? `Parsed intent: ${JSON.stringify(input.intent)}` : ""}

Available agent templates:
${AGENT_TEMPLATES.map((t) => `- ${t.id}: ${t.name} (${t.capabilities.join(", ")})`).join("\n")}
${skillsSection}
Return a JSON object with:
{
  "objective": "high-level objective summary",
  "reasoning": "why you decomposed it this way",
  "overallComplexity": "trivial|simple|moderate|complex|expert",
  "estimatedDurationMs": number,
  "tasks": [
    {
      "id": "task_1",
      "name": "short name",
      "description": "what this task does",
      "priority": "critical|high|medium|low",
      "complexity": "trivial|simple|moderate|complex|expert",
      "requiredCapabilities": ["capability_type"],
      "dependencies": [],
      "executionMode": "local|cloud|hybrid",
      "templateId": "tpl_xxx",
      "skillId": null
    }
  ]
}

Rules:
1. Tasks should be atomic and clearly scoped
2. Use dependencies to express ordering constraints
3. Maximize parallelism where possible
4. Match each task to the most appropriate template
5. Simple requests may need only 1-2 tasks
6. Complex requests may need 5-10 tasks
7. If a task can be fulfilled by an available skill, set skillId (e.g. "skill_3") and templateId to null — skills are faster than spawning agents

Respond ONLY with valid JSON, no markdown formatting.`;

    try {
      const cns = getOpenClawCNS();
      const response = await cns.chat(decomposePrompt, {
        preferLocal: orchestration.executionConfig.preferLocal,
      });

      const parsed = JSON.parse(typeof response === "string" ? response : (response as any).content || "{}");

      // Build task nodes
      const tasks: TaskNode[] = (parsed.tasks || []).map((t: any) => {
        // Extract numeric skill ID from "skill_3" format
        let skillId: number | undefined;
        if (typeof t.skillId === "string" && t.skillId.startsWith("skill_")) {
          skillId = parseInt(t.skillId.replace("skill_", ""), 10);
          if (isNaN(skillId)) skillId = undefined;
        } else if (typeof t.skillId === "number") {
          skillId = t.skillId;
        }

        return {
          id: (t.id || uuidv4()) as TaskNodeId,
          name: t.name || "Unnamed task",
          description: t.description || "",
          status: "pending" as TaskNodeStatus,
          priority: (t.priority || "medium") as TaskPriority,
          complexity: (t.complexity || "moderate") as TaskComplexity,
          requiredCapabilities: t.requiredCapabilities || [],
          dependencies: (t.dependencies || []) as TaskNodeId[],
          executionMode: t.executionMode || "hybrid",
          skillId,
          retryCount: 0,
          maxRetries: 3,
          createdAt: new Date().toISOString(),
        };
      });

      // Build agent assignments
      const agentAssignments: AgentAssignment[] = tasks.map((task: TaskNode, idx: number) => {
        const templateId = (parsed.tasks?.[idx] as any)?.templateId || "tpl_coder";
        const template = AGENT_TEMPLATES.find((t) => t.id === templateId) || AGENT_TEMPLATES[0];
        return {
          taskId: task.id,
          templateId: template.id,
          agentName: `${template.name} #${idx + 1}`,
          capabilities: template.capabilities,
          executionMode: task.executionMode,
        };
      });

      // Topological sort for execution order
      const executionOrder = this.topologicalSort(tasks);

      const plan: OrchestrationPlan = {
        id: planId,
        orchestrationId: orchestration.id,
        userInput: input,
        objective: parsed.objective || input.text,
        tasks,
        executionOrder,
        agentAssignments,
        estimatedDurationMs: parsed.estimatedDurationMs || 60000,
        overallComplexity: parsed.overallComplexity || "moderate",
        status: "draft" as PlanStatus,
        reasoning: parsed.reasoning || "Automated decomposition",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return plan;
    } catch (err: any) {
      logger.warn("AI decomposition failed, creating single-task plan:", err);

      // Fallback: single task
      const taskId = uuidv4() as TaskNodeId;
      const fallbackTask: TaskNode = {
        id: taskId,
        name: "Execute request",
        description: input.text,
        status: "pending",
        priority: "medium",
        complexity: "moderate",
        requiredCapabilities: ["text_generation"],
        dependencies: [],
        executionMode: "hybrid",
        retryCount: 0,
        maxRetries: 3,
        createdAt: new Date().toISOString(),
      };

      return {
        id: planId,
        orchestrationId: orchestration.id,
        userInput: input,
        objective: input.text,
        tasks: [fallbackTask],
        executionOrder: [taskId],
        agentAssignments: [
          {
            taskId,
            templateId: "tpl_coder",
            agentName: "General Agent",
            capabilities: ["text_generation", "code_generation"],
            executionMode: "hybrid",
          },
        ],
        estimatedDurationMs: 60000,
        overallComplexity: "moderate",
        status: "draft",
        reasoning: "Fallback single-task plan",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
  }

  // ===========================================================================
  // AGENT CREATION — creates agents via Swarm / Autonomous / Factory
  // ===========================================================================

  private async createAgentsForPlan(
    orchestration: Orchestration,
    plan: OrchestrationPlan,
  ): Promise<void> {
    const config = this.metaAgent!.creationConfig;

    // Create a swarm for coordination if enabled
    if (config.useSwarm && plan.tasks.length > 1) {
      try {
        const swarm = getAgentSwarm();
        const swarmResult = await swarm.createSwarm(
          `Orchestration ${orchestration.id.slice(0, 8)}`,
          plan.objective,
          {
            maxAgents: config.maxAgentsPerOrchestration,
            replicationEnabled: config.autoReplicate,
          },
        );
        orchestration.swarmId = swarmResult.id;
        this.addTrace(orchestration, "info", "swarm", `Created swarm: ${swarmResult.id}`);
      } catch (err: any) {
        logger.warn("Swarm creation failed:", err);
        this.addTrace(orchestration, "warn", "swarm", `Swarm creation failed: ${err.message}`);
      }
    }

    // Create agents for each task assignment
    for (const assignment of plan.agentAssignments) {
      try {
        const template = AGENT_TEMPLATES.find((t) => t.id === assignment.templateId);
        if (!template) continue;

        if (config.useSwarm && orchestration.swarmId) {
          // Spawn in swarm
          const swarm = getAgentSwarm();
          const agent = await swarm.spawnAgent(orchestration.swarmId as unknown as SwarmId, {
            name: assignment.agentName,
            role: template.type as any,
            config: {
              modelId: template.modelPreference === "local"
                ? orchestration.executionConfig.localModel
                : orchestration.executionConfig.cloudModel,
              systemPrompt: template.systemPrompt,
            },
          });
          assignment.createdAgentId = agent.id;
          assignment.createdVia = "swarm";

          // Link to task
          const task = plan.tasks.find((t) => t.id === assignment.taskId);
          if (task) task.swarmAgentId = agent.id;
        } else if (config.useAutonomousAgents) {
          // Create autonomous agent
          const autonomous = getAutonomousAgentSystem();
          const agent = await autonomous.createAgent({
            name: assignment.agentName,
            purpose: `${template.type}: ${template.systemPrompt}`,
            config: {
              primaryModel: template.modelPreference === "local"
                ? orchestration.executionConfig.localModel
                : orchestration.executionConfig.cloudModel,
            },
          });
          assignment.createdAgentId = agent.id;
          assignment.createdVia = "autonomous";

          const task = plan.tasks.find((t) => t.id === assignment.taskId);
          if (task) task.autonomousAgentId = agent.id;
        }

        this.emitEvent("agent:spawned", {
          orchestrationId: orchestration.id,
          agentId: assignment.createdAgentId,
          agentName: assignment.agentName,
          via: assignment.createdVia,
        });

        this.metaAgent!.stats.agentsCreated++;
      } catch (err: any) {
        logger.warn(`Failed to create agent for task ${assignment.taskId}:`, err);
        this.addTrace(orchestration, "warn", "agent_factory",
          `Agent creation failed for ${assignment.agentName}: ${err.message}`);
      }
    }
  }

  // ===========================================================================
  // TASK EXECUTION — runs the task graph respecting dependencies
  // ===========================================================================

  private async executePlan(
    orchestration: Orchestration,
    plan: OrchestrationPlan,
    commConfig: CommunicationConfig,
    longTermConfig?: Partial<LongTermTaskConfig>,
  ): Promise<void> {
    plan.status = "executing";
    const ltConfig = { ...this.longTermConfig, ...(longTermConfig ?? {}) };

    // Track completed tasks
    const completedTasks = new Set<string>();
    const failedTasks = new Set<string>();

    // Process tasks in dependency order, parallelizing where possible
    while (completedTasks.size + failedTasks.size < plan.tasks.length) {
      // Find tasks that are ready (all dependencies met)
      const readyTasks = plan.tasks.filter((task) => {
        if (completedTasks.has(task.id) || failedTasks.has(task.id)) return false;
        if (task.status === "running") return false;
        return task.dependencies.every((dep) => completedTasks.has(dep));
      });

      if (readyTasks.length === 0 && !plan.tasks.some((t) => t.status === "running")) {
        // Deadlock or all remaining tasks have failed dependencies
        const blockedTasks = plan.tasks.filter(
          (t) => !completedTasks.has(t.id) && !failedTasks.has(t.id),
        );
        for (const t of blockedTasks) {
          t.status = "blocked";
          failedTasks.add(t.id);
        }
        break;
      }

      // Limit parallel execution
      const batch = readyTasks.slice(0, orchestration.executionConfig.maxParallelAgents);

      // Execute batch in parallel
      const results = await Promise.allSettled(
        batch.map((task) => this.executeTask(orchestration, task, commConfig)),
      );

      // Process results
      for (let i = 0; i < results.length; i++) {
        const task = batch[i];
        const result = results[i];

        if (result.status === "fulfilled") {
          task.status = "completed";
          task.completedAt = new Date().toISOString();
          task.durationMs = task.startedAt
            ? new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()
            : 0;
          completedTasks.add(task.id);
          this.metaAgent!.stats.tasksCompleted++;

          this.emitEvent("orchestration:task:completed", {
            orchestrationId: orchestration.id,
            taskId: task.id,
            taskName: task.name,
          });
        } else {
          if (task.retryCount < task.maxRetries) {
            task.retryCount++;
            task.status = "retrying";
            this.addTrace(orchestration, "warn", "executor",
              `Task ${task.name} failed, retrying (${task.retryCount}/${task.maxRetries})`);
          } else {
            task.status = "failed";
            task.error = result.reason?.message || "Unknown error";
            task.completedAt = new Date().toISOString();
            failedTasks.add(task.id);
            this.metaAgent!.stats.tasksFailed++;

            this.emitEvent("orchestration:task:failed", {
              orchestrationId: orchestration.id,
              taskId: task.id,
              taskName: task.name,
              error: task.error,
            });
          }
        }
      }

      // Update progress
      const totalTasks = plan.tasks.length;
      const done = completedTasks.size + failedTasks.size;
      orchestration.progress = 40 + Math.round((done / totalTasks) * 50);

      this.emitEvent("orchestration:progress", {
        orchestrationId: orchestration.id,
        progress: orchestration.progress,
        completedTasks: completedTasks.size,
        failedTasks: failedTasks.size,
        totalTasks,
      });

      // Checkpoint if long-term config enables it
      if (ltConfig.enableCheckpoints) {
        await this.saveCheckpoint(orchestration, plan);
      }

      // Save orchestration state
      await this.saveOrchestration(orchestration);
    }

    plan.status = failedTasks.size > 0 && completedTasks.size === 0 ? "failed" : "completed";
  }

  // ===========================================================================
  // SINGLE TASK EXECUTION — routes through OpenClaw CNS
  // ===========================================================================

  private async executeTask(
    orchestration: Orchestration,
    task: TaskNode,
    commConfig: CommunicationConfig,
  ): Promise<Record<string, unknown>> {
    task.status = "running";
    task.startedAt = new Date().toISOString();

    this.addTrace(orchestration, "info", "executor", `Starting task: ${task.name}`, {
      taskId: task.id,
      capabilities: task.requiredCapabilities,
    });

    this.emitEvent("orchestration:task:started", {
      orchestrationId: orchestration.id,
      taskId: task.id,
      taskName: task.name,
    });

    // Collect input from completed dependencies
    const plan = orchestration.plan!;
    const depOutputs: Record<string, unknown> = {};
    for (const depId of task.dependencies) {
      const depTask = plan.tasks.find((t) => t.id === depId);
      if (depTask?.output) {
        depOutputs[depId] = depTask.output;
      }
    }
    task.input = depOutputs;

    // Short-circuit: if the task has a skillId, execute the skill directly
    if (task.skillId) {
      try {
        const { executeSkill } = await import("@/lib/skill_engine");
        const depContext = Object.values(depOutputs)
          .map((d) => (d as Record<string, unknown>)?.content || "")
          .filter(Boolean)
          .join("\n");
        const skillInput = depContext
          ? `${task.description}\n\nContext from previous tasks:\n${depContext}`
          : task.description;

        const result = await executeSkill({
          skillId: task.skillId,
          input: skillInput,
        });

        const content = result.output || "";
        task.output = { content, viaSkill: true, completedAt: new Date().toISOString() };

        this.addTrace(orchestration, "info", "executor",
          `Task completed via skill #${task.skillId}: ${task.name}`, {
            taskId: task.id,
            outputLength: content.length,
          });

        return task.output;
      } catch (err: any) {
        logger.warn(`Skill execution failed for task ${task.name}, falling through to CNS:`, err);
        // Fall through to standard CNS execution
      }
    }

    // Build execution prompt
    const taskPrompt = this.buildTaskPrompt(task, depOutputs, plan.objective);

    // Execute via OpenClaw CNS
    const cns = getOpenClawCNS();
    const shouldUseLocal = task.executionMode === "local" ||
      (task.executionMode === "hybrid" && task.complexity !== "expert" && task.complexity !== "complex");

    const response = await cns.chat(taskPrompt, {
      preferLocal: shouldUseLocal,
    });

    const content = typeof response === "string" ? response : (response as any).content || "";

    task.output = { content, completedAt: new Date().toISOString() };

    this.addTrace(orchestration, "info", "executor", `Task completed: ${task.name}`, {
      taskId: task.id,
      outputLength: content.length,
    });

    return task.output;
  }

  private buildTaskPrompt(
    task: TaskNode,
    depOutputs: Record<string, unknown>,
    objective: string,
  ): string {
    let prompt = `You are a specialized AI agent executing a task as part of a larger orchestration.

OVERALL OBJECTIVE: ${objective}

YOUR TASK: ${task.name}
DESCRIPTION: ${task.description}
REQUIRED CAPABILITIES: ${task.requiredCapabilities.join(", ")}
PRIORITY: ${task.priority}
`;

    if (Object.keys(depOutputs).length > 0) {
      prompt += `\nINPUT FROM PREVIOUS TASKS:\n`;
      for (const [depId, output] of Object.entries(depOutputs)) {
        const content = typeof output === "object" ? JSON.stringify(output, null, 2) : String(output);
        prompt += `--- Task ${depId} output ---\n${content.slice(0, 2000)}\n`;
      }
    }

    prompt += `\nExecute this task thoroughly and return your results. Be specific and actionable.`;

    return prompt;
  }

  // ===========================================================================
  // RESULT AGGREGATION
  // ===========================================================================

  private async aggregateResults(
    orchestration: Orchestration,
    plan: OrchestrationPlan,
  ): Promise<OrchestrationResult> {
    const taskResults: Record<string, unknown> = {};
    const artifacts: OrchestrationArtifact[] = [];
    let localInferences = 0;
    let cloudInferences = 0;

    for (const task of plan.tasks) {
      taskResults[task.id] = task.output;

      // Count inference types
      if (task.executionMode === "local") localInferences++;
      else if (task.executionMode === "cloud") cloudInferences++;
      else {
        // Hybrid — count based on complexity
        if (task.complexity === "trivial" || task.complexity === "simple") localInferences++;
        else cloudInferences++;
      }
    }

    // Generate summary via AI
    let summary = "Orchestration completed.";
    try {
      const cns = getOpenClawCNS();
      const summaryPrompt = `Summarize the results of this multi-task orchestration:

Objective: ${plan.objective}

Task results:
${plan.tasks
  .filter((t) => t.status === "completed")
  .map((t) => `- ${t.name}: ${JSON.stringify(t.output || {}).slice(0, 500)}`)
  .join("\n")}

Provide a concise summary of what was accomplished.`;

      const response = await cns.chat(summaryPrompt, {
        preferLocal: true,
      });
      summary = typeof response === "string" ? response : (response as any).content || summary;
    } catch {
      summary = `Completed ${plan.tasks.filter((t) => t.status === "completed").length}/${plan.tasks.length} tasks for: ${plan.objective}`;
    }

    const stats: OrchestrationResultStats = {
      totalTasks: plan.tasks.length,
      completedTasks: plan.tasks.filter((t) => t.status === "completed").length,
      failedTasks: plan.tasks.filter((t) => t.status === "failed").length,
      skippedTasks: plan.tasks.filter((t) => t.status === "cancelled" || t.status === "blocked").length,
      totalAgentsCreated: plan.agentAssignments.filter((a) => a.createdAgentId).length,
      totalDurationMs: orchestration.durationMs || 0,
      tokensUsed: 0,
      localInferences,
      cloudInferences,
    };

    return {
      summary,
      taskResults,
      artifacts,
      stats,
    };
  }

  // ===========================================================================
  // ORCHESTRATION MANAGEMENT
  // ===========================================================================

  getOrchestration(id: OrchestrationId): Orchestration | undefined {
    return this.orchestrations.get(id);
  }

  listOrchestrations(filter?: { status?: OrchestrationStatus; limit?: number }): Orchestration[] {
    let results = Array.from(this.orchestrations.values());

    if (filter?.status) {
      results = results.filter((o) => o.status === filter.status);
    }

    results.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    if (filter?.limit) {
      results = results.slice(0, filter.limit);
    }

    return results;
  }

  async cancelOrchestration(id: OrchestrationId): Promise<void> {
    const orchestration = this.orchestrations.get(id);
    if (!orchestration) throw new Error(`Orchestration not found: ${id}`);

    orchestration.status = "cancelled";
    orchestration.completedAt = new Date().toISOString();
    orchestration.durationMs = new Date(orchestration.completedAt).getTime() -
      new Date(orchestration.createdAt).getTime();

    // Cancel running tasks
    if (orchestration.plan) {
      for (const task of orchestration.plan.tasks) {
        if (task.status === "running" || task.status === "pending" || task.status === "queued") {
          task.status = "cancelled";
        }
      }
    }

    // Terminate swarm if created
    if (orchestration.swarmId) {
      try {
        const swarm = getAgentSwarm();
        await swarm.terminateSwarm(orchestration.swarmId as unknown as SwarmId);
      } catch {
        // Best effort
      }
    }

    await this.saveOrchestration(orchestration);
    this.emitEvent("orchestration:cancelled", { orchestrationId: id });
  }

  async pauseOrchestration(id: OrchestrationId): Promise<void> {
    const orchestration = this.orchestrations.get(id);
    if (!orchestration) throw new Error(`Orchestration not found: ${id}`);
    if (orchestration.status !== "executing") throw new Error("Can only pause executing orchestrations");

    orchestration.status = "paused" as any;
    await this.saveCheckpoint(orchestration, orchestration.plan!);
    await this.saveOrchestration(orchestration);
  }

  async resumeOrchestration(id: OrchestrationId): Promise<void> {
    const orchestration = this.orchestrations.get(id);
    if (!orchestration) throw new Error(`Orchestration not found: ${id}`);

    orchestration.status = "executing";
    // Re-run pipeline from last checkpoint
    this.runOrchestrationPipeline(
      orchestration,
      this.communicationConfig,
    ).catch((err) => {
      logger.error(`Resume failed for ${id}:`, err);
    });
  }

  // ===========================================================================
  // DASHBOARD / STATUS
  // ===========================================================================

  async getDashboard(): Promise<OrchestratorDashboard> {
    const activeOrchestrations = this.listOrchestrations({ status: "executing" });
    const recentOrchestrations = this.listOrchestrations({ limit: 10 });

    return {
      metaAgent: this.metaAgent!,
      activeOrchestrations,
      recentOrchestrations,
      systemStatus: await this.getSystemStatus(),
      capabilities: this.metaAgent?.capabilities || [],
    };
  }

  async getSystemStatus(): Promise<SystemStatus> {
    let ollamaAvailable = false;
    let n8nAvailable = false;
    let openclawCnsInitialized = false;
    let voiceAvailable = false;
    let swarmActive = false;
    let activeAgents = 0;
    let activeSwarms = 0;
    let activeMissions = 0;

    try {
      const bridge = getOpenClawOllamaBridge();
      ollamaAvailable = await bridge.checkOllamaHealth();
    } catch { /* ignore */ }

    try {
      const cns = getOpenClawCNS();
      const status = cns.getStatus();
      openclawCnsInitialized = status.initialized || false;
    } catch { /* ignore */ }

    try {
      const swarm = getAgentSwarm();
      const swarms = swarm.listSwarms?.() || [];
      activeSwarms = Array.isArray(swarms) ? swarms.length : 0;
      swarmActive = activeSwarms > 0;
    } catch { /* ignore */ }

    try {
      const state = voiceAssistant.getState();
      voiceAvailable = state !== "error";
    } catch { /* ignore */ }

    return {
      ollamaAvailable,
      n8nAvailable,
      openclawCnsInitialized,
      voiceAvailable,
      swarmActive,
      activeAgents,
      activeSwarms,
      activeMissions,
    };
  }

  // ===========================================================================
  // CHECKPOINTING
  // ===========================================================================

  private async saveCheckpoint(orchestration: Orchestration, plan: OrchestrationPlan): Promise<void> {
    const checkpoint: TaskCheckpoint = {
      id: uuidv4(),
      orchestrationId: orchestration.id,
      taskId: "plan" as TaskNodeId,
      timestamp: new Date().toISOString(),
      state: {
        planStatus: plan.status,
        tasks: plan.tasks.map((t) => ({ id: t.id, status: t.status, output: t.output })),
        progress: orchestration.progress,
      },
      progress: orchestration.progress,
      resumable: true,
    };

    const existing = this.checkpoints.get(orchestration.id) || [];
    existing.push(checkpoint);
    this.checkpoints.set(orchestration.id, existing);

    // Persist to disk
    const checkpointPath = path.join(this.dataDir, "checkpoints", `${orchestration.id}.json`);
    await fs.writeJson(checkpointPath, existing, { spaces: 2 });

    this.emitEvent("checkpoint:saved", {
      orchestrationId: orchestration.id,
      checkpointId: checkpoint.id,
      progress: checkpoint.progress,
    });
  }

  // ===========================================================================
  // PERSISTENCE
  // ===========================================================================

  private async saveOrchestration(orchestration: Orchestration): Promise<void> {
    const filePath = path.join(this.dataDir, "orchestrations", `${orchestration.id}.json`);
    await fs.writeJson(filePath, orchestration, { spaces: 2 });
  }

  private async saveAllOrchestrations(): Promise<void> {
    for (const orchestration of this.orchestrations.values()) {
      await this.saveOrchestration(orchestration);
    }
  }

  private async loadOrchestrations(): Promise<void> {
    const dir = path.join(this.dataDir, "orchestrations");
    if (!(await fs.pathExists(dir))) return;

    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = await fs.readJson(path.join(dir, file));
        this.orchestrations.set(data.id, data);
      } catch (err) {
        logger.warn(`Failed to load orchestration ${file}:`, err);
      }
    }

    logger.info(`Loaded ${this.orchestrations.size} orchestrations from disk`);
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  private topologicalSort(tasks: TaskNode[]): TaskNodeId[] {
    const visited = new Set<string>();
    const sorted: TaskNodeId[] = [];
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const task = taskMap.get(id as TaskNodeId);
      if (task) {
        for (const dep of task.dependencies) {
          visit(dep);
        }
      }
      sorted.push(id as TaskNodeId);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return sorted;
  }

  private updateMetaAgentStats(orchestration: Orchestration): void {
    if (!this.metaAgent) return;

    const stats = this.metaAgent.stats;
    stats.totalOrchestrations++;
    this.metaAgent.orchestrationHistory.push(orchestration.id);

    if (orchestration.durationMs) {
      const totalTime = stats.averageCompletionTimeMs * (stats.totalOrchestrations - 1) +
        orchestration.durationMs;
      stats.averageCompletionTimeMs = totalTime / stats.totalOrchestrations;
    }

    const total = stats.tasksCompleted + stats.tasksFailed;
    stats.successRate = total > 0 ? stats.tasksCompleted / total : 1;

    this.metaAgent.updatedAt = new Date().toISOString();
  }

  private addTrace(
    orchestration: Orchestration,
    level: "debug" | "info" | "warn" | "error",
    source: string,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    orchestration.trace.push({
      id: uuidv4() as ExecutionTraceId,
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      data,
    });
  }

  private emitEvent(type: OrchestratorEventType, data: Record<string, unknown>): void {
    const event: OrchestratorEvent = {
      type,
      timestamp: new Date().toISOString(),
      orchestrationId: data.orchestrationId as OrchestrationId | undefined,
      taskId: data.taskId as TaskNodeId | undefined,
      data,
    };
    this.emit("event", event);
  }

  // ===========================================================================
  // CONFIG MANAGEMENT
  // ===========================================================================

  getExecutionConfig(): ExecutionConfig {
    return { ...this.executionConfig };
  }

  updateExecutionConfig(updates: Partial<ExecutionConfig>): ExecutionConfig {
    this.executionConfig = { ...this.executionConfig, ...updates };
    return this.executionConfig;
  }

  getCommunicationConfig(): CommunicationConfig {
    return { ...this.communicationConfig };
  }

  updateCommunicationConfig(updates: Partial<CommunicationConfig>): CommunicationConfig {
    this.communicationConfig = { ...this.communicationConfig, ...updates };
    return this.communicationConfig;
  }

  getLongTermConfig(): LongTermTaskConfig {
    return { ...this.longTermConfig };
  }

  updateLongTermConfig(updates: Partial<LongTermTaskConfig>): LongTermTaskConfig {
    this.longTermConfig = { ...this.longTermConfig, ...updates };
    return this.longTermConfig;
  }

  getTemplates(): AgentTemplate[] {
    return this.metaAgent?.templates || [...AGENT_TEMPLATES];
  }
}
