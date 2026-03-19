/**
 * Data Flywheel Engine
 * Orchestrates the self-reinforcing loop:
 * Interactions → Training Pairs → Dataset → Fine-Tune → Smarter Models
 *
 * Per-agent configurable with 3 capture modes:
 * - Auto-capture: Every Q&A pair saved automatically
 * - Thumbs feedback: User rates responses (positive/negative)
 * - Corrections: User provides corrected outputs
 */

import { db } from "@/db";
import {
  flywheelTrainingPairs,
  flywheelRuns,
} from "@/db/flywheel_schema";
import { agents, messages } from "@/db/schema";
import { eq, and, isNull, sql, desc, count } from "drizzle-orm";
import log from "electron-log";
import type { FlywheelConfig } from "@/types/agent_builder";
import type { AgentConfig } from "@/types/agent_builder";

const logger = log.scope("data_flywheel");

// =============================================================================
// TYPES
// =============================================================================

export interface CaptureParams {
  agentId?: number | null;
  appId?: number;
  sourceType: "chat" | "openclaw" | "agent_test" | "correction";
  userInput: string;
  assistantOutput: string;
  rating?: "positive" | "negative" | null;
  correctedOutput?: string | null;
  messageId?: number | null;
  model?: string | null;
}

export interface FlywheelStats {
  totalPairs: number;
  pendingPairs: number;
  capturedPairs: number;
  positivePairs: number;
  negativePairs: number;
  correctedPairs: number;
  totalRuns: number;
  lastRunAt: Date | null;
  lastRunStatus: string | null;
}

export interface FlywheelRunRecord {
  id: number;
  agentId: number | null;
  status: string;
  trainingSamplesCount: number;
  datasetId: string | null;
  jobId: string | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

// =============================================================================
// CAPTURE
// =============================================================================

/**
 * Capture a training pair for the flywheel.
 * Called from chat stream, agent test, or correction flows.
 */
export async function captureTrainingPair(
  params: CaptureParams,
): Promise<number> {
  const [row] = await db
    .insert(flywheelTrainingPairs)
    .values({
      agentId: params.agentId ?? null,
      appId: params.appId ?? null,
      sourceType: params.sourceType,
      userInput: params.userInput,
      assistantOutput: params.assistantOutput,
      rating: params.rating ?? null,
      correctedOutput: params.correctedOutput ?? null,
      captured: false,
      messageId: params.messageId ?? null,
      model: params.model ?? null,
    })
    .returning({ id: flywheelTrainingPairs.id });

  logger.info("Captured training pair", {
    id: row.id,
    agentId: params.agentId,
    sourceType: params.sourceType,
  });

  return row.id;
}

/**
 * Update the rating on the most recent training pair matching a source and model.
 * Used by kanban task rating to attach human feedback to the flywheel.
 */
export async function updateTrainingPairRating(
  sourceType: "chat" | "openclaw" | "agent_test" | "correction",
  model: string,
  rating: "positive" | "negative",
): Promise<boolean> {
  const rows = await db
    .update(flywheelTrainingPairs)
    .set({ rating })
    .where(
      and(
        eq(flywheelTrainingPairs.sourceType, sourceType),
        eq(flywheelTrainingPairs.model, model),
        isNull(flywheelTrainingPairs.rating),
      ),
    )
    .returning({ id: flywheelTrainingPairs.id });

  if (rows.length > 0) {
    logger.info("Updated training pair rating", { id: rows[0].id, rating });
    return true;
  }
  return false;
}

// =============================================================================
// RATING & CORRECTIONS
// =============================================================================

/**
 * Rate a message and capture the training pair.
 * Updates the message's approvalState and records the pair.
 */
export async function rateMessage(
  messageId: number,
  rating: "positive" | "negative",
): Promise<void> {
  // Get the message and its preceding user message
  const [msg] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);

  if (!msg || msg.role !== "assistant") {
    throw new Error("Message not found or not an assistant message");
  }

  // Update approvalState on the message
  await db
    .update(messages)
    .set({
      approvalState: rating === "positive" ? "approved" : "rejected",
    })
    .where(eq(messages.id, messageId));

  // Find the preceding user message in the same chat
  const [userMsg] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.chatId, msg.chatId),
        eq(messages.role, "user"),
        sql`${messages.id} < ${messageId}`,
      ),
    )
    .orderBy(desc(messages.id))
    .limit(1);

  if (!userMsg) {
    logger.warn("No preceding user message found for rating", { messageId });
    return;
  }

  // Resolve agentId from the chat's app
  const agentId = await resolveAgentIdFromChat(msg.chatId);

  await captureTrainingPair({
    agentId,
    sourceType: "chat",
    userInput: userMsg.content,
    assistantOutput: msg.content,
    rating,
    messageId,
    model: msg.model,
  });

  // Record MAB reward for the model that generated this response
  if (msg.model) {
    try {
      const { mabEngine } = await import("@/lib/mab_engine");
      const contextKey = agentId
        ? `model_quality_agent_${agentId}`
        : "model_quality_global";
      await mabEngine.recordRewardByName(
        "model_selection",
        contextKey,
        msg.model,
        rating === "positive" ? 1.0 : 0.0,
        { source: "user", feedback: rating },
      );
    } catch (err) {
      logger.warn("MAB reward recording failed:", err);
    }
  }
}

/**
 * Correct a message and capture the correction as a training pair.
 */
export async function correctMessage(
  messageId: number,
  correctedOutput: string,
): Promise<void> {
  const [msg] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, messageId))
    .limit(1);

  if (!msg || msg.role !== "assistant") {
    throw new Error("Message not found or not an assistant message");
  }

  // Find the preceding user message
  const [userMsg] = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.chatId, msg.chatId),
        eq(messages.role, "user"),
        sql`${messages.id} < ${messageId}`,
      ),
    )
    .orderBy(desc(messages.id))
    .limit(1);

  if (!userMsg) {
    throw new Error("No preceding user message found");
  }

  const agentId = await resolveAgentIdFromChat(msg.chatId);

  await captureTrainingPair({
    agentId,
    sourceType: "correction",
    userInput: userMsg.content,
    assistantOutput: correctedOutput, // Use corrected version as the "good" output
    rating: "positive",
    correctedOutput,
    messageId,
    model: msg.model,
  });
}

// =============================================================================
// DATASET BUILDING
// =============================================================================

/**
 * Get uncaptured (pending) training pairs for an agent.
 */
export async function getUnprocessedPairs(
  agentId?: number | null,
  limit = 5000,
) {
  const conditions = [eq(flywheelTrainingPairs.captured, false)];

  if (agentId != null) {
    conditions.push(eq(flywheelTrainingPairs.agentId, agentId));
  }

  return db
    .select()
    .from(flywheelTrainingPairs)
    .where(and(...conditions))
    .orderBy(flywheelTrainingPairs.createdAt)
    .limit(limit);
}

/**
 * Build a training dataset from uncaptured pairs.
 * Returns Alpaca-formatted data ready for local_fine_tuning.createDataset().
 */
export async function buildTrainingData(agentId?: number | null): Promise<{
  data: Array<{ instruction: string; input: string; output: string }>;
  pairIds: number[];
}> {
  const pairs = await getUnprocessedPairs(agentId);

  if (pairs.length === 0) {
    return { data: [], pairIds: [] };
  }

  // For corrections, use correctedOutput; for positive ratings, use assistantOutput
  // For negative ratings without correction, skip (garbage-in prevention)
  const data: Array<{ instruction: string; input: string; output: string }> =
    [];
  const pairIds: number[] = [];

  for (const pair of pairs) {
    // Skip negative-rated pairs without corrections
    if (pair.rating === "negative" && !pair.correctedOutput) {
      continue;
    }

    const output = pair.correctedOutput || pair.assistantOutput;

    data.push({
      instruction: "Respond helpfully to the user's message.",
      input: pair.userInput,
      output,
    });
    pairIds.push(pair.id);
  }

  return { data, pairIds };
}

/**
 * Mark pairs as captured (included in a training dataset).
 */
export async function markPairsCaptured(pairIds: number[]): Promise<void> {
  if (pairIds.length === 0) return;

  // Process in chunks to avoid SQLite parameter limits
  const chunkSize = 500;
  for (let i = 0; i < pairIds.length; i += chunkSize) {
    const chunk = pairIds.slice(i, i + chunkSize);
    await db
      .update(flywheelTrainingPairs)
      .set({ captured: true })
      .where(
        sql`${flywheelTrainingPairs.id} IN (${sql.join(
          chunk.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      );
  }
}

// =============================================================================
// FLYWHEEL CYCLE
// =============================================================================

/**
 * Run a full flywheel cycle for an agent:
 * 1. Collect unprocessed pairs
 * 2. Build training dataset via LocalFineTuning.createDataset()
 * 3. Create and start a training job
 * 4. Record the run
 */
export async function runFlywheelCycle(
  agentId?: number | null,
): Promise<FlywheelRunRecord> {
  // Dynamically import to avoid circular deps
  const { LocalFineTuning } = await import("@/lib/local_fine_tuning");

  // Create a run record
  const [run] = await db
    .insert(flywheelRuns)
    .values({
      agentId: agentId ?? null,
      status: "building_dataset",
      trainingSamplesCount: 0,
    })
    .returning();

  try {
    // 1. Build training data
    const { data, pairIds } = await buildTrainingData(agentId);

    if (data.length === 0) {
      await db
        .update(flywheelRuns)
        .set({
          status: "completed",
          trainingSamplesCount: 0,
          completedAt: new Date(),
        })
        .where(eq(flywheelRuns.id, run.id));

      logger.info("Flywheel cycle: no training data available", { agentId });
      return { ...run, status: "completed", trainingSamplesCount: 0, completedAt: new Date() };
    }

    // 2. Resolve agent config for base model + method
    let baseModel = "tinyllama";
    let trainingMethod: "lora" | "qlora" | "full" = "lora";

    if (agentId) {
      const [agent] = await db
        .select({ configJson: agents.configJson })
        .from(agents)
        .where(eq(agents.id, agentId))
        .limit(1);

      const config = agent?.configJson as AgentConfig | null;
      if (config?.flywheel) {
        baseModel = config.flywheel.baseModel || baseModel;
        trainingMethod = config.flywheel.trainingMethod || trainingMethod;
      }
    }

    // 3. Create dataset via LocalFineTuning
    const ft = new LocalFineTuning();
    await ft.initialize();

    const agentLabel = agentId ? `agent-${agentId}` : "global";
    const timestamp = new Date().toISOString().slice(0, 10);

    const dataset = await ft.createDataset({
      name: `flywheel-${agentLabel}-${timestamp}`,
      format: "alpaca",
      data,
      metadata: {
        source: "data_flywheel",
        agentId,
        pairCount: data.length,
      },
    });

    // Update run with dataset info
    await db
      .update(flywheelRuns)
      .set({
        status: "training",
        trainingSamplesCount: data.length,
        datasetId: dataset.id,
      })
      .where(eq(flywheelRuns.id, run.id));

    // 4. Create training job
    const job = await ft.createTrainingJob({
      name: `flywheel-${agentLabel}-${timestamp}`,
      baseModel: baseModel as keyof typeof import("@/lib/local_fine_tuning")["SUPPORTED_BASE_MODELS"],
      baseModelPath: "", // Will be resolved by LocalFineTuning
      datasetId: dataset.id,
      method: trainingMethod,
      metadata: {
        source: "data_flywheel",
        agentId,
        runId: run.id,
      },
    });

    // 5. Mark pairs as captured
    await markPairsCaptured(pairIds);

    // 6. Start training (async — will run in background)
    ft.startTraining(job.id).catch((err) => {
      logger.error("Flywheel training failed", { jobId: job.id, error: err });
      db.update(flywheelRuns)
        .set({
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
        })
        .where(eq(flywheelRuns.id, run.id))
        .then(() => {});
    });

    // Listen for training completion to update run
    ft.on("job:completed", (completedJob) => {
      if (completedJob.id === job.id) {
        db.update(flywheelRuns)
          .set({
            status: "completed",
            jobId: job.id,
            completedAt: new Date(),
          })
          .where(eq(flywheelRuns.id, run.id))
          .then(() => {
            logger.info("Flywheel cycle completed", {
              runId: run.id,
              samples: data.length,
            });

            // Register the new adapter as a MAB arm
            const adapterName = `flywheel-${agentLabel}-${timestamp}`;
            const contextKey = agentId
              ? `model_quality_agent_${agentId}`
              : "model_quality_global";

            import("@/lib/mab_engine")
              .then(({ mabEngine }) =>
                mabEngine.recordRewardByName(
                  "model_selection",
                  contextKey,
                  adapterName,
                  0.5, // neutral initial reward
                  { source: "system", feedback: "flywheel_adapter_created" },
                ),
              )
              .then(() => {
                logger.info("Registered flywheel adapter as MAB arm", {
                  adapterName,
                  contextKey,
                });
              })
              .catch((err) => {
                logger.warn("Failed to register MAB arm:", err);
              });
          });
      }
    });

    ft.on("job:failed", ({ job: failedJob, error }) => {
      if (failedJob.id === job.id) {
        db.update(flywheelRuns)
          .set({
            status: "failed",
            error: String(error),
            completedAt: new Date(),
          })
          .where(eq(flywheelRuns.id, run.id))
          .then(() => {});
      }
    });

    const updatedRun: FlywheelRunRecord = {
      ...run,
      status: "training",
      trainingSamplesCount: data.length,
      datasetId: dataset.id,
      jobId: job.id,
    };

    logger.info("Flywheel cycle started training", {
      runId: run.id,
      agentId,
      samples: data.length,
      baseModel,
      method: trainingMethod,
    });

    return updatedRun;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await db
      .update(flywheelRuns)
      .set({
        status: "failed",
        error: errorMsg,
        completedAt: new Date(),
      })
      .where(eq(flywheelRuns.id, run.id));

    logger.error("Flywheel cycle failed", { runId: run.id, error: errorMsg });
    return { ...run, status: "failed", error: errorMsg, completedAt: new Date() };
  }
}

// =============================================================================
// STATS & QUERIES
// =============================================================================

/**
 * Get flywheel statistics for an agent (or global if agentId is null).
 */
export async function getFlywheelStats(
  agentId?: number | null,
): Promise<FlywheelStats> {
  const agentCondition =
    agentId != null
      ? eq(flywheelTrainingPairs.agentId, agentId)
      : undefined;

  const [totals] = await db
    .select({ count: count() })
    .from(flywheelTrainingPairs)
    .where(agentCondition);

  const [pending] = await db
    .select({ count: count() })
    .from(flywheelTrainingPairs)
    .where(
      agentCondition
        ? and(agentCondition, eq(flywheelTrainingPairs.captured, false))
        : eq(flywheelTrainingPairs.captured, false),
    );

  const [positive] = await db
    .select({ count: count() })
    .from(flywheelTrainingPairs)
    .where(
      agentCondition
        ? and(agentCondition, eq(flywheelTrainingPairs.rating, "positive"))
        : eq(flywheelTrainingPairs.rating, "positive"),
    );

  const [negative] = await db
    .select({ count: count() })
    .from(flywheelTrainingPairs)
    .where(
      agentCondition
        ? and(agentCondition, eq(flywheelTrainingPairs.rating, "negative"))
        : eq(flywheelTrainingPairs.rating, "negative"),
    );

  const [corrected] = await db
    .select({ count: count() })
    .from(flywheelTrainingPairs)
    .where(
      agentCondition
        ? and(
            agentCondition,
            sql`${flywheelTrainingPairs.correctedOutput} IS NOT NULL`,
          )
        : sql`${flywheelTrainingPairs.correctedOutput} IS NOT NULL`,
    );

  const runCondition =
    agentId != null ? eq(flywheelRuns.agentId, agentId) : undefined;

  const [runTotals] = await db
    .select({ count: count() })
    .from(flywheelRuns)
    .where(runCondition);

  const [lastRun] = await db
    .select()
    .from(flywheelRuns)
    .where(runCondition)
    .orderBy(desc(flywheelRuns.startedAt))
    .limit(1);

  return {
    totalPairs: totals.count,
    pendingPairs: pending.count,
    capturedPairs: totals.count - pending.count,
    positivePairs: positive.count,
    negativePairs: negative.count,
    correctedPairs: corrected.count,
    totalRuns: runTotals.count,
    lastRunAt: lastRun?.startedAt ?? null,
    lastRunStatus: lastRun?.status ?? null,
  };
}

/**
 * Get flywheel run history.
 */
export async function getFlywheelRuns(
  agentId?: number | null,
  limit = 20,
): Promise<FlywheelRunRecord[]> {
  const condition =
    agentId != null ? eq(flywheelRuns.agentId, agentId) : undefined;

  return db
    .select()
    .from(flywheelRuns)
    .where(condition)
    .orderBy(desc(flywheelRuns.startedAt))
    .limit(limit);
}

// =============================================================================
// AGENT CONFIG HELPERS
// =============================================================================

/**
 * Get the flywheel config for an agent.
 */
export async function getAgentFlywheelConfig(
  agentId: number,
): Promise<FlywheelConfig | null> {
  const [agent] = await db
    .select({ configJson: agents.configJson })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);

  const config = agent?.configJson as AgentConfig | null;
  return config?.flywheel ?? null;
}

/**
 * Check whether auto-capture is enabled for an agent.
 */
export async function isAutoCaptureEnabled(
  agentId: number,
): Promise<boolean> {
  const fw = await getAgentFlywheelConfig(agentId);
  return fw?.enabled === true && fw?.modes?.autoCapture === true;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Resolve agentId from a chatId by looking up the chat → app → agent chain.
 */
async function resolveAgentIdFromChat(
  chatId: number,
): Promise<number | null> {
  const { chats } = await import("@/db/schema");

  const [chat] = await db
    .select({ appId: chats.appId })
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);

  if (!chat) return null;

  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(eq(agents.appId, chat.appId))
    .limit(1);

  return agent?.id ?? null;
}

// =============================================================================
// N8N SCHEDULED FLYWHEEL
// =============================================================================

/**
 * Run the flywheel for all agents that have scheduled flywheel enabled.
 * Called by n8n cron or manually.
 */
export async function runScheduledFlywheels(): Promise<{
  processed: number;
  results: Array<{ agentId: number; status: string; samples: number }>;
}> {
  const allAgents = await db
    .select({ id: agents.id, configJson: agents.configJson })
    .from(agents);

  const results: Array<{ agentId: number; status: string; samples: number }> =
    [];

  for (const agent of allAgents) {
    const config = agent.configJson as AgentConfig | null;
    const fw = config?.flywheel;

    if (!fw?.enabled || fw.schedule === "manual") continue;

    // Check if there are enough pending pairs
    const stats = await getFlywheelStats(agent.id);
    if (stats.pendingPairs < (fw.minSamplesBeforeTraining || 50)) continue;

    try {
      const run = await runFlywheelCycle(agent.id);
      results.push({
        agentId: agent.id,
        status: run.status,
        samples: run.trainingSamplesCount,
      });
    } catch (err) {
      logger.error("Scheduled flywheel failed for agent", {
        agentId: agent.id,
        error: err,
      });
      results.push({ agentId: agent.id, status: "failed", samples: 0 });
    }
  }

  return { processed: results.length, results };
}

// =============================================================================
// INTERNAL SCHEDULER
// =============================================================================

const DAILY_MS = 24 * 60 * 60 * 1000;
const WEEKLY_MS = 7 * DAILY_MS;

let flywheelTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the internal flywheel scheduler.
 * Checks every 6 hours whether any agent is due for a training cycle.
 */
export function startFlywheelScheduler(): void {
  if (flywheelTimer) return;

  const CHECK_INTERVAL = 6 * 60 * 60 * 1000; // 6 hours

  flywheelTimer = setInterval(() => {
    runScheduledFlywheels().catch((err) =>
      logger.error("Flywheel scheduler tick failed:", err),
    );
  }, CHECK_INTERVAL);

  logger.info("Flywheel scheduler started (6 hour check interval)");
}

/**
 * Stop the internal flywheel scheduler.
 */
export function stopFlywheelScheduler(): void {
  if (flywheelTimer) {
    clearInterval(flywheelTimer);
    flywheelTimer = null;
    logger.info("Flywheel scheduler stopped");
  }
}

// =============================================================================
// N8N WORKFLOW REGISTRATION
// =============================================================================

/**
 * Build and register an n8n workflow that triggers the flywheel via HTTP.
 * The workflow uses a Schedule Trigger node firing at the configured cadence,
 * then an HTTP Request node that calls the JoyCreate flywheel endpoint.
 *
 * Since JoyCreate is a desktop app without an HTTP server, the n8n workflow
 * instead acts as a scheduling coordination layer — the actual work is done
 * by the internal scheduler. This function creates the workflow as a visible
 * dashboard item in n8n.
 */
export async function registerFlywheelN8nWorkflow(
  schedule: "daily" | "weekly",
): Promise<{ workflowId: string } | null> {
  try {
    const {
      createWorkflow,
      activateWorkflow,
      listWorkflows,
      deleteWorkflow,
    } = await import("@/ipc/handlers/n8n_handlers");

    // Remove any existing flywheel workflow first
    const existing = await listWorkflows();
    if (existing?.data) {
      for (const wf of existing.data) {
        if (wf.name === "JoyCreate Data Flywheel") {
          await deleteWorkflow(wf.id!);
        }
      }
    }

    const cronExpression =
      schedule === "daily" ? "0 2 * * *" : "0 2 * * 0"; // 2am daily or 2am Sunday

    const workflow = await createWorkflow({
      name: "JoyCreate Data Flywheel",
      active: false,
      nodes: [
        {
          id: "schedule-trigger",
          name: "Schedule Trigger",
          type: "n8n-nodes-base.scheduleTrigger",
          typeVersion: 1,
          position: [250, 300],
          parameters: {
            rule: {
              interval: [
                {
                  field: "cronExpression",
                  expression: cronExpression,
                },
              ],
            },
          },
        },
        {
          id: "flywheel-note",
          name: "Flywheel Info",
          type: "n8n-nodes-base.noOp",
          typeVersion: 1,
          position: [450, 300],
          parameters: {},
          notes: `This workflow tracks the ${schedule} flywheel schedule.\nActual training is handled by JoyCreate's internal scheduler.\nSchedule: ${cronExpression}`,
          notesInFlow: true,
        },
      ],
      connections: {
        "Schedule Trigger": {
          main: [[{ node: "Flywheel Info", type: "main", index: 0 }]],
        },
      },
      settings: {
        executionOrder: "v1",
      },
    });

    if (workflow?.id) {
      await activateWorkflow(workflow.id);
      logger.info("Registered n8n flywheel workflow", {
        id: workflow.id,
        schedule,
      });
      return { workflowId: workflow.id };
    }

    return null;
  } catch (err) {
    logger.warn("Failed to register n8n flywheel workflow:", err);
    return null;
  }
}

/**
 * Remove the n8n flywheel workflow (when flywheel is disabled or set to manual).
 */
export async function removeFlywheelN8nWorkflow(): Promise<void> {
  try {
    const { listWorkflows, deleteWorkflow } = await import(
      "@/ipc/handlers/n8n_handlers"
    );

    const existing = await listWorkflows();
    if (existing?.data) {
      for (const wf of existing.data) {
        if (wf.name === "JoyCreate Data Flywheel") {
          await deleteWorkflow(wf.id!);
          logger.info("Removed n8n flywheel workflow", { id: wf.id });
        }
      }
    }
  } catch (err) {
    logger.warn("Failed to remove n8n flywheel workflow:", err);
  }
}
