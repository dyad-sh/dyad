/**
 * OpenClaw Autonomous Brain
 *
 * Takes natural language instructions and autonomously executes
 * multi-step plans across all JoyCreate features.
 *
 * Flow:
 *   User instruction
 *     → CNS AI planner (understands action catalog)
 *     → ExecutionPlan (ordered steps with dependencies)
 *     → Dispatch each step via openclaw_actions
 *     → Self-correct on failure (re-plan or retry)
 *     → Return aggregated results
 */

import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import log from "electron-log";

import { getOpenClawCNS } from "./openclaw_cns";
import { getOpenClawCostEngine } from "./openclaw_cost_engine";
import {
  dispatchAction,
  getActionCatalogForPlanner,
  getActionCatalog,
} from "./openclaw_actions";
import type {
  AutonomousExecution,
  AutonomousRequest,
  AutonomousStatus,
  ExecutionPlan,
  PlannedStep,
  StepResult,
  ExecutionStatus,
} from "@/types/openclaw_autonomous_types";

const logger = log.scope("openclaw_autonomous");

// ── Singleton ──────────────────────────────────────────────────────────────

let instance: OpenClawAutonomous | null = null;

export function getOpenClawAutonomous(): OpenClawAutonomous {
  if (!instance) {
    instance = new OpenClawAutonomous();
  }
  return instance;
}

// ── Main Class ─────────────────────────────────────────────────────────────

export class OpenClawAutonomous extends EventEmitter {
  private executions: Map<string, AutonomousExecution> = new Map();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    logger.info("🦞 OpenClaw Autonomous Brain initialized");
    this.emit("initialized");
  }

  async shutdown(): Promise<void> {
    // Cancel all running executions
    for (const exec of this.executions.values()) {
      if (exec.status === "planning" || exec.status === "executing") {
        exec.status = "cancelled";
      }
    }
    this.initialized = false;
    this.emit("shutdown");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute an autonomous task from natural language.
   *
   * 1. AI planner analyzes the instruction
   * 2. Creates an execution plan using available actions
   * 3. Executes each step in dependency order
   * 4. Self-corrects on failure
   */
  async execute(request: AutonomousRequest): Promise<AutonomousExecution> {
    if (!this.initialized) {
      await this.initialize();
    }

    const executionId = uuidv4();
    const execution: AutonomousExecution = {
      id: executionId,
      input: request.input,
      status: "planning",
      currentStepIndex: -1,
      progress: 0,
      results: [],
      createdAt: new Date().toISOString(),
    };

    this.executions.set(executionId, execution);
    this.emit("execution:started", { id: executionId, input: request.input });

    try {
      // Step 1: Plan
      logger.info(`Planning execution: ${executionId}`);
      const plan = await this.createPlan(request);
      execution.plan = plan;
      execution.progress = 10;
      this.emit("execution:planned", { id: executionId, plan });

      // Step 1.5: Check cost budget before proceeding
      try {
        const costEngine = getOpenClawCostEngine();
        const costEstimate = costEngine.estimatePlanCost(
          plan.steps.map((s) => ({ actionId: s.actionId })),
          "gemini-flash-latest", // planning model estimate
          2000,
        );
        const budgetCheck = costEngine.checkBudget(costEstimate.totalEstimate);
        if (!budgetCheck.allowed) {
          logger.warn(`Budget check failed: ${budgetCheck.reason}`);
          execution.error = `Cost guard: ${budgetCheck.reason}. Remaining daily: $${budgetCheck.remainingDailyUsd.toFixed(2)}, monthly: $${budgetCheck.remainingMonthlyUsd.toFixed(2)}`;
          execution.status = "paused";
          this.emit("execution:awaiting-approval", {
            id: executionId,
            plan,
            costWarning: budgetCheck.reason,
          });
          return execution;
        }
      } catch {
        // Cost engine is best-effort, don't block on errors
      }

      // If plan-only mode, stop here
      if (request.planOnly) {
        execution.status = "pending";
        return execution;
      }

      // If approval required, pause
      if (request.requireApproval) {
        execution.status = "paused";
        this.emit("execution:awaiting-approval", { id: executionId, plan });
        return execution;
      }

      // Step 2: Execute
      await this.executePlan(execution);
      return execution;
    } catch (error) {
      execution.status = "failed";
      execution.error = (error as Error).message;
      execution.completedAt = new Date().toISOString();
      this.emit("execution:failed", { id: executionId, error: (error as Error).message });
      return execution;
    }
  }

  /** Approve and resume a paused execution. */
  async approve(executionId: string): Promise<AutonomousExecution> {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution not found: ${executionId}`);
    if (execution.status !== "paused") {
      throw new Error(`Execution ${executionId} is not paused (status: ${execution.status})`);
    }

    this.emit("execution:approved", { id: executionId });
    await this.executePlan(execution);
    return execution;
  }

  /** Cancel a running or paused execution. */
  cancel(executionId: string): AutonomousExecution {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`Execution not found: ${executionId}`);
    execution.status = "cancelled";
    execution.completedAt = new Date().toISOString();
    this.emit("execution:cancelled", { id: executionId });
    return execution;
  }

  getExecution(id: string): AutonomousExecution | undefined {
    return this.executions.get(id);
  }

  listExecutions(): AutonomousExecution[] {
    return Array.from(this.executions.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  getStatus(): AutonomousStatus {
    const all = Array.from(this.executions.values());
    return {
      initialized: this.initialized,
      activeExecutions: all.filter((e) => e.status === "executing" || e.status === "planning").length,
      completedExecutions: all.filter((e) => e.status === "completed").length,
      failedExecutions: all.filter((e) => e.status === "failed").length,
      availableActions: getActionCatalog().length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PLANNING — Uses CNS AI to create a plan from natural language
  // ═══════════════════════════════════════════════════════════════════════════

  private async createPlan(request: AutonomousRequest): Promise<ExecutionPlan> {
    const cns = getOpenClawCNS();
    const actionCatalog = getActionCatalogForPlanner();

    // Decide whether to use local model for planning based on budget pressure
    let preferLocal = false;
    try {
      const costEngine = getOpenClawCostEngine();
      const summary = costEngine.getSummary();
      if (summary.overBudget || summary.warningActive) {
        preferLocal = true;
        logger.info("\ud83e\udd9e Cost-aware planning: using local model due to budget pressure");
      }
    } catch {
      // best-effort
    }

    const contextStr = request.context
      ? `\nContext: ${JSON.stringify(request.context)}`
      : "";

    const planPrompt = `You are the autonomous planning engine for JoyCreate, a powerful desktop app creation platform.

Given the user's instruction, create an execution plan using ONLY the actions available below.

## AVAILABLE ACTIONS
${actionCatalog}

## USER INSTRUCTION
"${request.input}"${contextStr}

## RULES
1. Use ONLY action IDs from the catalog above
2. Each step must have a valid actionId and the correct parameters
3. Steps can depend on previous steps (use step IDs in dependencies array)
4. Maximize parallelism — steps without dependencies can run together
5. For multi-step processes (build → deploy → publish), chain dependencies correctly
6. If the user wants something not covered by available actions, explain in the reasoning
7. Keep plans minimal — don't add unnecessary steps

## OUTPUT FORMAT (JSON only, no markdown)
{
  "objective": "one-line summary of what this plan achieves",
  "reasoning": "why these steps in this order",
  "steps": [
    {
      "id": "step_1",
      "actionId": "category.action_name",
      "description": "what this step does",
      "params": { "paramName": "value" },
      "dependencies": []
    }
  ]
}

Respond with ONLY the JSON object. No markdown, no explanations outside the JSON.`;

    const response = await cns.chat(planPrompt, {
      preferLocal, // Use local model when budget is tight
      systemPrompt: "You are a task planning AI. Respond only with valid JSON.",
    });

    let parsed: { objective: string; reasoning: string; steps: any[] };
    try {
      const cleaned = response.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      throw new Error(`Failed to parse AI plan: ${response.slice(0, 200)}`);
    }

    const plan: ExecutionPlan = {
      id: uuidv4(),
      objective: parsed.objective || "Execute user request",
      reasoning: parsed.reasoning || "",
      steps: (parsed.steps || []).map(
        (s: any): PlannedStep => ({
          id: s.id || uuidv4(),
          actionId: s.actionId,
          description: s.description || "",
          params: s.params || {},
          dependencies: s.dependencies || [],
          status: "pending",
        }),
      ),
      createdAt: new Date().toISOString(),
    };

    // Validate all action IDs exist
    const catalog = getActionCatalog();
    const validIds = new Set(catalog.map((a) => a.id));
    for (const step of plan.steps) {
      if (!validIds.has(step.actionId)) {
        logger.warn(`Plan references unknown action: ${step.actionId}`);
      }
    }

    return plan;
  }

  private isCancelled(execution: AutonomousExecution): boolean {
    return execution.status === "cancelled";
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXECUTION — Runs the plan steps in dependency order
  // ═══════════════════════════════════════════════════════════════════════════

  private async executePlan(execution: AutonomousExecution): Promise<void> {
    if (!execution.plan) throw new Error("No plan to execute");

    execution.status = "executing";
    execution.startedAt = new Date().toISOString();
    const plan = execution.plan;

    const completedSteps = new Set<string>();
    const failedSteps = new Set<string>();
    const totalSteps = plan.steps.length;

    // Execute steps respecting dependencies
    while (completedSteps.size + failedSteps.size < totalSteps) {
      if (this.isCancelled(execution)) break;

      // Find steps whose dependencies are all completed
      const ready = plan.steps.filter(
        (s) =>
          s.status === "pending" &&
          s.dependencies.every((dep) => completedSteps.has(dep)),
      );

      if (ready.length === 0) {
        // No steps ready but not all done — deadlock or blocked by failures
        const remaining = plan.steps.filter(
          (s) => s.status === "pending",
        );
        if (remaining.length > 0) {
          logger.warn(
            `${remaining.length} steps blocked by failed dependencies`,
          );
          for (const s of remaining) {
            s.status = "failed";
            s.error = "Blocked by failed dependency";
            failedSteps.add(s.id);
          }
        }
        break;
      }

      // Execute ready steps in parallel
      const results = await Promise.allSettled(
        ready.map((step) => this.executeStep(step, execution)),
      );

      for (let i = 0; i < ready.length; i++) {
        const step = ready[i];
        const result = results[i];

        if (result.status === "fulfilled") {
          completedSteps.add(step.id);
        } else {
          failedSteps.add(step.id);
          // Try self-correction
          const corrected = await this.trySelfCorrect(
            step,
            result.reason,
            execution,
          );
          if (corrected) {
            completedSteps.add(step.id);
            failedSteps.delete(step.id);
          }
        }
      }

      execution.progress =
        10 + Math.round(((completedSteps.size + failedSteps.size) / totalSteps) * 90);
      this.emit("execution:progress", {
        id: execution.id,
        progress: execution.progress,
        completedSteps: completedSteps.size,
        totalSteps,
      });
    }

    // Finalize
    execution.completedAt = new Date().toISOString();
    execution.durationMs =
      new Date(execution.completedAt).getTime() -
      new Date(execution.startedAt!).getTime();

    if (this.isCancelled(execution)) {
      return;
    }

    if (failedSteps.size === 0) {
      execution.status = "completed";
      execution.progress = 100;
      this.emit("execution:completed", {
        id: execution.id,
        results: execution.results,
      });
    } else if (completedSteps.size > 0) {
      // Partial success
      execution.status = "completed";
      execution.progress = 100;
      execution.error = `${failedSteps.size} of ${totalSteps} steps failed`;
      this.emit("execution:completed", {
        id: execution.id,
        results: execution.results,
        partialFailure: true,
      });
    } else {
      execution.status = "failed";
      execution.error = "All steps failed";
      this.emit("execution:failed", {
        id: execution.id,
        error: execution.error,
      });
    }
  }

  private async executeStep(
    step: PlannedStep,
    execution: AutonomousExecution,
  ): Promise<void> {
    step.status = "executing";
    step.startedAt = new Date().toISOString();
    execution.currentStepIndex = execution.plan!.steps.indexOf(step);

    logger.info(`Executing step: ${step.id} (${step.actionId})`, step.params);
    this.emit("step:started", {
      executionId: execution.id,
      stepId: step.id,
      actionId: step.actionId,
    });

    const startTime = Date.now();

    try {
      const output = await dispatchAction(step.actionId, step.params);
      const durationMs = Date.now() - startTime;

      step.status = "completed";
      step.result = output;
      step.completedAt = new Date().toISOString();
      step.durationMs = durationMs;

      execution.results.push({
        stepId: step.id,
        actionId: step.actionId,
        success: true,
        output,
        durationMs,
      });

      this.emit("step:completed", {
        executionId: execution.id,
        stepId: step.id,
        actionId: step.actionId,
        output,
        durationMs,
      });
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const msg = (error as Error).message;

      step.status = "failed";
      step.error = msg;
      step.completedAt = new Date().toISOString();
      step.durationMs = durationMs;

      execution.results.push({
        stepId: step.id,
        actionId: step.actionId,
        success: false,
        error: msg,
        durationMs,
      });

      this.emit("step:failed", {
        executionId: execution.id,
        stepId: step.id,
        actionId: step.actionId,
        error: msg,
      });

      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SELF-CORRECTION — Ask AI to fix failed steps
  // ═══════════════════════════════════════════════════════════════════════════

  private async trySelfCorrect(
    step: PlannedStep,
    error: Error,
    execution: AutonomousExecution,
  ): Promise<boolean> {
    logger.info(`Attempting self-correction for step ${step.id}: ${error.message}`);

    try {
      const cns = getOpenClawCNS();

      const correctionPrompt = `A step in an autonomous execution plan failed. Analyze the error and suggest a corrected version of the step.

Failed step:
- Action: ${step.actionId}
- Description: ${step.description}
- Parameters: ${JSON.stringify(step.params)}
- Error: ${error.message}

Original objective: ${execution.plan?.objective}

If the error is fixable by changing parameters, respond with:
{"fixable": true, "params": {corrected parameters}, "explanation": "what was wrong"}

If the error is NOT fixable (missing data, authentication required, etc.), respond with:
{"fixable": false, "explanation": "why it can't be fixed autonomously"}

Respond with ONLY JSON, no markdown.`;

      const response = await cns.chat(correctionPrompt, {
        systemPrompt: "You are an error recovery AI. Respond only with valid JSON.",
      });

      const cleaned = response.replace(/```json?\s*/g, "").replace(/```\s*/g, "").trim();
      const correction = JSON.parse(cleaned);

      if (correction.fixable && correction.params) {
        logger.info(`Self-correction: retrying step ${step.id} with new params`);
        step.params = correction.params;
        step.status = "pending";
        step.error = undefined;

        // Retry
        await this.executeStep(step, execution);
        return true;
      }

      logger.info(`Step ${step.id} not fixable: ${correction.explanation}`);
      return false;
    } catch (corrError) {
      logger.warn(`Self-correction failed for step ${step.id}:`, corrError);
      return false;
    }
  }
}
