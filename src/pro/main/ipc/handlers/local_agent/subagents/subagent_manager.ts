import crypto from "node:crypto";
import { streamText, type ModelMessage, type ToolSet } from "ai";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { WebContents } from "electron";

import { db } from "@/db";
import { agentMessages, agentThreads, chats, messages } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getModelClient } from "@/ipc/utils/get_model_client";
import { getAiHeaders, getProviderOptions } from "@/ipc/utils/provider_options";
import {
  cancelOrphanedBaseStream,
  fastTextOutput,
} from "@/ipc/utils/stream_text_utils";
import type { SubagentPersona, SubagentThreadSummary } from "@/ipc/types";
import { isDyadProEnabled } from "@/lib/schemas";
import { readSettings } from "@/main/settings";
import { getDyadAppPath } from "@/paths/paths";
import type { AgentContext } from "../tools/types";
import { buildReviewTarget, type ReviewTarget } from "./review_target";
import {
  acquireMutationLease,
  hasMutationLease,
  releaseMutationLease,
} from "./mutation_lease";

const MODELS = {
  explorer: { provider: "openai", name: "gpt-5.6-luna", effort: "high" },
  reviewer: { provider: "openai", name: "gpt-5.6-sol", effort: "medium" },
  implementer: { provider: "openai", name: "gpt-5.6-luna", effort: "high" },
} as const;

const RUNNING = ["queued", "running", "waiting_for_writer"] as const;
const abortControllers = new Map<string, AbortController>();
const skippedAutoFixes = new Set<string>();
const followupRunners = new Map<string, (assignment: string) => void>();
const activeRunsByChat = new Map<number, Set<string>>();
const pendingRuns: Array<{
  threadId: string;
  chatId: number;
  source: "model" | "review_button" | "auto_review" | "followup";
  run: () => Promise<void>;
}> = [];
let eventTarget: WebContents | null = null;

export function setSubagentEventTarget(target: WebContents): void {
  eventTarget = target;
}

export async function recoverInterruptedSubagents(): Promise<void> {
  await db
    .update(agentThreads)
    .set({
      status: "interrupted_by_restart",
      completedAt: new Date(),
      updatedAt: new Date(),
      error: "Dyad restarted while this sub-agent was active.",
    })
    .where(inArray(agentThreads.status, [...RUNNING]));
}

export async function listSubagents(
  chatId: number,
): Promise<SubagentThreadSummary[]> {
  assertPro("explorer");
  const rows = await db.query.agentThreads.findMany({
    where: eq(agentThreads.chatId, chatId),
    orderBy: [desc(agentThreads.createdAt)],
  });
  return rows.map(toSummary);
}

export async function getSubagentMessages(threadId: string) {
  assertPro("explorer");
  return db.query.agentMessages.findMany({
    where: eq(agentMessages.threadId, threadId),
    orderBy: [asc(agentMessages.sequence)],
  });
}

export async function spawnModelSubagent(params: {
  ctx: AgentContext;
  persona: "explorer" | "implementer";
  taskName: string;
  assignment: string;
  scope: string[];
  buildTools: (threadId: string) => ToolSet;
}): Promise<string> {
  assertPro(params.persona);
  const settings = readSettings();
  if (params.persona === "explorer" && !settings.enableExplorerSubagent) {
    throw new DyadError(
      "Explorer is disabled in Settings.",
      DyadErrorKind.Precondition,
    );
  }
  if (params.persona === "implementer" && !settings.enableImplementerSubagent) {
    throw new DyadError(
      "Implementer is disabled in Settings.",
      DyadErrorKind.Precondition,
    );
  }
  if (params.persona === "implementer" && params.scope.length === 0) {
    throw new DyadError(
      "Implementer requires an explicit path scope.",
      DyadErrorKind.Validation,
    );
  }

  const thread = await createThread({
    chatId: params.ctx.chatId,
    persona: params.persona,
    taskName: params.taskName,
    assignment: params.assignment,
    invocationSource: "model",
    contextJson: { scope: params.scope },
  });
  const tools = params.buildTools(thread.id);
  const run = (assignment: string) =>
    enqueueRun({
      threadId: thread.id,
      chatId: params.ctx.chatId,
      source: "model",
      run: () =>
        runThread(thread.id, params.ctx.appId, assignment, tools, params.scope),
    });
  followupRunners.set(thread.id, run);
  run(params.assignment);
  return thread.id;
}

export async function startReview(params: {
  chatId: number;
  sourceMessageId: number;
  invocationSource: "review_button" | "auto_review";
}): Promise<SubagentThreadSummary> {
  assertPro("reviewer");
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, params.chatId),
    with: { app: true },
  });
  const source = await db.query.messages.findFirst({
    where: and(
      eq(messages.id, params.sourceMessageId),
      eq(messages.chatId, params.chatId),
    ),
  });
  if (!chat?.app || !source || source.role !== "assistant") {
    throw new DyadError(
      "Assistant message or chat not found.",
      DyadErrorKind.NotFound,
    );
  }
  const target = await buildReviewTarget({
    appPath: getDyadAppPath(chat.app.path),
    baseCommit: source.sourceCommitHash,
    targetCommit: source.commitHash,
  });
  if (!target.diff.trim()) {
    throw new DyadError(
      "There are no changes to review.",
      DyadErrorKind.Precondition,
    );
  }
  const existing = await db.query.agentThreads.findFirst({
    where: and(
      eq(agentThreads.chatId, params.chatId),
      eq(agentThreads.reviewDiffHash, target.hash),
    ),
    orderBy: [desc(agentThreads.createdAt)],
  });
  if (existing) return toSummary(existing);
  const thread = await createThread({
    chatId: params.chatId,
    persona: "reviewer",
    taskName: `Review ${target.files.length} changed file${target.files.length === 1 ? "" : "s"}`,
    assignment: "Independently review the latest assistant turn's changes.",
    invocationSource: params.invocationSource,
    contextJson: { files: target.files, exclusions: target.exclusions },
    review: target,
  });
  const run = (followup?: string) =>
    enqueueRun({
      threadId: thread.id,
      chatId: params.chatId,
      source: params.invocationSource,
      run: () =>
        runReview(
          thread.id,
          chat.app.id,
          getDyadAppPath(chat.app.path),
          target,
          followup,
        ),
    });
  followupRunners.set(thread.id, run);
  run();
  return toSummary(thread);
}

export async function cancelSubagent(threadId: string): Promise<void> {
  assertPro("explorer");
  abortControllers.get(threadId)?.abort();
  const pendingIndex = pendingRuns.findIndex(
    (run) => run.threadId === threadId,
  );
  if (pendingIndex >= 0) pendingRuns.splice(pendingIndex, 1);
  await finishThread(threadId, "cancelled", null, "Cancelled by user.");
}

export async function skipReviewAutoFix(threadId: string): Promise<void> {
  assertPro("reviewer");
  skippedAutoFixes.add(threadId);
}

export async function buildFixFindingsPrompt(
  threadId: string,
): Promise<string> {
  assertPro("reviewer");
  const thread = await getThread(threadId);
  if (thread.persona !== "reviewer" || !thread.resultJson) {
    throw new DyadError(
      "This review has no findings to fix.",
      DyadErrorKind.Precondition,
    );
  }
  return `Fix the actionable findings from this independent review. Keep the changes scoped to the reviewed diff, validate the fixes, and do not dismiss findings without evidence.\n\nReview target: ${thread.reviewDiffHash}\n\n${String(thread.resultJson.report ?? "")}`;
}

export async function runAutoReviewBarrier(params: {
  chatId: number;
  verification?: boolean;
}): Promise<{
  outcome: "released" | "skipped" | "fix_required";
  threadId?: string;
  prompt?: string;
}> {
  const settings = readSettings();
  if (!settings.enableAutoReview || !isDyadProEnabled(settings))
    return { outcome: "skipped" };
  const latest = await db.query.messages.findFirst({
    where: and(
      eq(messages.chatId, params.chatId),
      eq(messages.role, "assistant"),
    ),
    orderBy: [desc(messages.createdAt)],
  });
  if (!latest) return { outcome: "skipped" };
  let summary: SubagentThreadSummary;
  try {
    summary = await startReview({
      chatId: params.chatId,
      sourceMessageId: latest.id,
      invocationSource: "auto_review",
    });
  } catch {
    return { outcome: "released" };
  }
  while (["queued", "running", "waiting_for_writer"].includes(summary.status)) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    summary = toSummary(await getThread(summary.id));
  }
  const findingCount = Number(summary.result?.findingCount ?? 0);
  if (
    summary.status !== "completed" ||
    findingCount === 0 ||
    params.verification
  )
    return { outcome: "released", threadId: summary.id };

  const autoFixAt = new Date(Date.now() + 10_000);
  await db
    .update(agentThreads)
    .set({ status: "auto_fix_countdown", autoFixAt, updatedAt: new Date() })
    .where(eq(agentThreads.id, summary.id));
  emit(summary.chatId, summary.id);
  while (
    Date.now() < autoFixAt.getTime() &&
    !skippedAutoFixes.has(summary.id)
  ) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (skippedAutoFixes.delete(summary.id)) {
    await db
      .update(agentThreads)
      .set({ status: "completed", autoFixAt: null, updatedAt: new Date() })
      .where(eq(agentThreads.id, summary.id));
    emit(summary.chatId, summary.id);
    return { outcome: "released", threadId: summary.id };
  }
  await db
    .update(agentThreads)
    .set({ status: "fixing_findings", autoFixAt: null, updatedAt: new Date() })
    .where(eq(agentThreads.id, summary.id));
  emit(summary.chatId, summary.id);
  return {
    outcome: "fix_required",
    threadId: summary.id,
    prompt: await buildFixFindingsPrompt(summary.id),
  };
}

export async function sendSubagentMessage(
  threadId: string,
  content: string,
): Promise<void> {
  assertPro("explorer");
  const latest = await db.query.agentMessages.findFirst({
    where: eq(agentMessages.threadId, threadId),
    orderBy: [desc(agentMessages.sequence)],
  });
  await db.insert(agentMessages).values({
    threadId,
    sequence: (latest?.sequence ?? 0) + 1,
    messageId: crypto.randomUUID(),
    role: "root",
    content,
  });
  const thread = await getThread(threadId);
  emit(thread.chatId, threadId);
}

export async function followupSubagent(
  threadId: string,
  assignment: string,
): Promise<void> {
  await sendSubagentMessage(threadId, assignment);
  const run = followupRunners.get(threadId);
  if (!run) {
    throw new DyadError(
      "This sub-agent was interrupted by an app restart and cannot resume.",
      DyadErrorKind.Precondition,
    );
  }
  const thread = await getThread(threadId);
  if (["queued", "running", "waiting_for_writer"].includes(thread.status)) {
    return;
  }
  await db
    .update(agentMessages)
    .set({ consumed: true })
    .where(
      and(
        eq(agentMessages.threadId, threadId),
        eq(agentMessages.consumed, false),
        eq(agentMessages.role, "root"),
      ),
    );
  await db
    .update(agentThreads)
    .set({
      status: "queued",
      invocationSource: "followup",
      resultJson: null,
      error: null,
      startedAt: null,
      completedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(agentThreads.id, threadId));
  emit(thread.chatId, threadId);
  run(assignment);
}

async function runThread(
  threadId: string,
  appId: number,
  assignment: string,
  tools: ToolSet,
  scope: string[],
): Promise<void> {
  const thread = await getThread(threadId);
  const controller = new AbortController();
  abortControllers.set(threadId, controller);
  const entitlementWatcher = watchEntitlement(threadId, controller);
  try {
    while (
      thread.persona === "implementer" &&
      !acquireMutationLease({ appId, threadId, scope })
    ) {
      await setWaitingForWriter(threadId);
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (controller.signal.aborted) return;
    }
    await updateStatus(threadId, "running");
    const result = await runModel({
      threadId,
      appId,
      persona: thread.persona,
      assignment,
      tools,
      abortSignal: controller.signal,
    });
    await appendAssistantMessage(threadId, result);
    await finishThread(threadId, "completed", { report: result }, null);
  } catch (error) {
    if (controller.signal.aborted) return;
    await finishThread(
      threadId,
      isDyadProEnabled(readSettings()) ? "failed" : "entitlement_revoked",
      null,
      errorMessage(error),
    );
  } finally {
    clearInterval(entitlementWatcher);
    releaseMutationLease(appId, threadId);
    abortControllers.delete(threadId);
  }
}

async function runReview(
  threadId: string,
  appId: number,
  appPath: string,
  target: ReviewTarget,
  followup?: string,
): Promise<void> {
  const controller = new AbortController();
  abortControllers.set(threadId, controller);
  const entitlementWatcher = watchEntitlement(threadId, controller);
  try {
    while (hasMutationLease(appId)) {
      await setWaitingForWriter(threadId);
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (controller.signal.aborted) return;
    }
    await updateStatus(threadId, "running");
    const report = await runModel({
      threadId,
      appId,
      persona: "reviewer",
      assignment: `Review this exact diff. Report only actionable defects introduced by it. For every finding use a line beginning "FINDING:" followed by severity, file/line, impact, and remediation. End with "FINDING_COUNT: N". If there are no findings, end with "FINDING_COUNT: 0".${followup ? `\n\nFollow-up request: ${followup}` : ""}\n\nFiles: ${target.files.join(", ")}\nExcluded: ${target.exclusions.join(", ") || "none"}\n\n${target.diff}`,
      tools: {},
      abortSignal: controller.signal,
    });
    const count = Number(report.match(/FINDING_COUNT:\s*(\d+)/i)?.[1] ?? 0);
    const currentTarget = await buildReviewTarget({
      appPath,
      baseCommit: target.baseCommit,
      targetCommit: target.targetCommit,
    });
    if (currentTarget.hash !== target.hash) {
      await appendAssistantMessage(threadId, report);
      await finishThread(
        threadId,
        "review_outdated",
        { report, findingCount: count },
        "The review target changed while Reviewer was running.",
      );
      return;
    }
    await appendAssistantMessage(threadId, report);
    await finishThread(
      threadId,
      "completed",
      { report, findingCount: count },
      null,
    );
  } catch (error) {
    if (controller.signal.aborted) return;
    await finishThread(
      threadId,
      isDyadProEnabled(readSettings()) ? "failed" : "entitlement_revoked",
      null,
      errorMessage(error),
    );
  } finally {
    clearInterval(entitlementWatcher);
    abortControllers.delete(threadId);
  }
}

async function runModel(params: {
  threadId: string;
  appId: number;
  persona: SubagentPersona;
  assignment: string;
  tools: ToolSet;
  abortSignal: AbortSignal;
}): Promise<string> {
  assertPro(params.persona);
  const defaults = MODELS[params.persona];
  const settings = {
    ...readSettings(),
    selectedModel: { provider: defaults.provider, name: defaults.name },
    thinkingBudget: defaults.effort,
  };
  const modelInfo = await getModelClient(settings.selectedModel, settings);
  const result = streamText({
    output: fastTextOutput(),
    model: modelInfo.modelClient.model,
    headers: getAiHeaders({
      builtinProviderId: modelInfo.modelClient.builtinProviderId,
    }),
    providerOptions: getProviderOptions({
      dyadAppId: params.appId,
      dyadDisableFiles: true,
      files: [],
      mentionedAppsCodebases: [],
      builtinProviderId: modelInfo.modelClient.builtinProviderId,
      settings,
    }),
    system: systemPrompt(params.persona),
    prompt: params.assignment,
    tools: params.tools,
    prepareStep: async ({ messages: stepMessages }) => {
      assertPro(params.persona);
      const pending = await db.query.agentMessages.findMany({
        where: and(
          eq(agentMessages.threadId, params.threadId),
          eq(agentMessages.consumed, false),
          eq(agentMessages.role, "root"),
        ),
        orderBy: [asc(agentMessages.sequence)],
      });
      if (pending.length === 0) return {};
      for (const message of pending) {
        await db
          .update(agentMessages)
          .set({ consumed: true })
          .where(eq(agentMessages.id, message.id));
      }
      return {
        messages: [
          ...stepMessages,
          ...pending.map(
            (message): ModelMessage => ({
              role: "user",
              content: `Root message: ${message.content}`,
            }),
          ),
        ],
      };
    },
    stopWhen: () => false,
    abortSignal: params.abortSignal,
  });
  cancelOrphanedBaseStream(result);
  const [text, usage, steps] = await Promise.all([
    result.text,
    result.totalUsage,
    result.steps,
  ]);
  const thread = await getThread(params.threadId);
  await db
    .update(agentThreads)
    .set({
      inputTokens: thread.inputTokens + (usage.inputTokens ?? 0),
      outputTokens: thread.outputTokens + (usage.outputTokens ?? 0),
      toolCallCount:
        thread.toolCallCount +
        steps.reduce((count, step) => count + step.toolCalls.length, 0),
      updatedAt: new Date(),
    })
    .where(eq(agentThreads.id, params.threadId));
  emit(thread.chatId, params.threadId);
  return text;
}

function systemPrompt(persona: SubagentPersona): string {
  if (persona === "reviewer")
    return "You are Dyad Reviewer. Be independent, concise, evidence-based, and read-only.";
  if (persona === "implementer")
    return "You are Dyad Implementer. Complete only the bounded assignment using only provided tools and assigned paths. Report changed files and unresolved issues.";
  return "You are Dyad Explorer. Investigate read-only, cite files and evidence, and return a concise report with confidence and recommended next action.";
}

async function createThread(params: {
  chatId: number;
  persona: SubagentPersona;
  taskName: string;
  assignment: string;
  invocationSource: "model" | "review_button" | "auto_review" | "followup";
  contextJson: Record<string, unknown>;
  review?: ReviewTarget;
}) {
  const defaults = MODELS[params.persona];
  const [row] = await db
    .insert(agentThreads)
    .values({
      id: crypto.randomUUID(),
      chatId: params.chatId,
      persona: params.persona,
      taskName: params.taskName,
      assignment: params.assignment,
      status: "queued",
      provider: defaults.provider,
      model: defaults.name,
      reasoningEffort: defaults.effort,
      invocationSource: params.invocationSource,
      contextJson: params.contextJson,
      reviewBaseCommit: params.review?.baseCommit,
      reviewTargetCommit: params.review?.targetCommit,
      reviewDiffHash: params.review?.hash,
    })
    .returning();
  emit(params.chatId, row.id);
  return row;
}

async function updateStatus(
  threadId: string,
  status: "running",
): Promise<void> {
  const thread = await getThread(threadId);
  await db
    .update(agentThreads)
    .set({ status, startedAt: new Date(), updatedAt: new Date() })
    .where(eq(agentThreads.id, threadId));
  emit(thread.chatId, threadId);
}

async function setWaitingForWriter(threadId: string): Promise<void> {
  const thread = await getThread(threadId);
  await db
    .update(agentThreads)
    .set({ status: "waiting_for_writer", updatedAt: new Date() })
    .where(eq(agentThreads.id, threadId));
  emit(thread.chatId, threadId);
}

async function finishThread(
  threadId: string,
  status:
    | "completed"
    | "failed"
    | "cancelled"
    | "review_outdated"
    | "entitlement_revoked",
  resultJson: Record<string, unknown> | null,
  error: string | null,
): Promise<void> {
  const thread = await getThread(threadId);
  await db
    .update(agentThreads)
    .set({
      status,
      resultJson,
      error,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(agentThreads.id, threadId));
  emit(thread.chatId, threadId);
}

async function appendAssistantMessage(
  threadId: string,
  content: string,
): Promise<void> {
  const latest = await db.query.agentMessages.findFirst({
    where: eq(agentMessages.threadId, threadId),
    orderBy: [desc(agentMessages.sequence)],
  });
  await db.insert(agentMessages).values({
    threadId,
    sequence: (latest?.sequence ?? 0) + 1,
    messageId: crypto.randomUUID(),
    role: "assistant",
    content,
  });
}

async function getThread(threadId: string) {
  const thread = await db.query.agentThreads.findFirst({
    where: eq(agentThreads.id, threadId),
  });
  if (!thread)
    throw new DyadError("Sub-agent thread not found.", DyadErrorKind.NotFound);
  return thread;
}

function assertPro(persona: SubagentPersona): void {
  if (!isDyadProEnabled(readSettings())) {
    throw new DyadError(
      `${persona} sub-agents require Dyad Pro.`,
      DyadErrorKind.Auth,
    );
  }
}

function emit(chatId: number, threadId: string): void {
  const target = eventTarget;
  if (target && !target.isDestroyed())
    target.send("agent:subagent-update", { chatId, threadId });
}

function toSummary(
  row: typeof agentThreads.$inferSelect,
): SubagentThreadSummary {
  return {
    id: row.id,
    chatId: row.chatId,
    persona: row.persona,
    taskName: row.taskName,
    assignment: row.assignment,
    status: row.status,
    provider: row.provider,
    model: row.model,
    reasoningEffort: row.reasoningEffort,
    result: row.resultJson,
    reviewBaseCommit: row.reviewBaseCommit,
    reviewTargetCommit: row.reviewTargetCommit,
    reviewDiffHash: row.reviewDiffHash,
    invocationSource: row.invocationSource,
    autoFixAt: row.autoFixAt,
    error: row.error,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    toolCallCount: row.toolCallCount,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    updatedAt: row.updatedAt,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function enqueueRun(item: (typeof pendingRuns)[number]): void {
  if (item.source === "auto_review") {
    for (let index = pendingRuns.length - 1; index >= 0; index--) {
      const pending = pendingRuns[index];
      if (pending.chatId === item.chatId && pending.source === "auto_review") {
        pendingRuns.splice(index, 1);
        void finishThread(
          pending.threadId,
          "cancelled",
          null,
          "Superseded by a newer auto-review target.",
        );
      }
    }
  }
  if (item.source === "review_button") {
    const firstAutoReview = pendingRuns.findIndex(
      (pending) =>
        pending.chatId === item.chatId && pending.source === "auto_review",
    );
    if (firstAutoReview >= 0) pendingRuns.splice(firstAutoReview, 0, item);
    else pendingRuns.push(item);
  } else {
    pendingRuns.push(item);
  }
  drainRuns(item.chatId);
}

function drainRuns(chatId: number): void {
  const active = activeRunsByChat.get(chatId) ?? new Set<string>();
  activeRunsByChat.set(chatId, active);
  while (active.size < 3) {
    const index = pendingRuns.findIndex((item) => item.chatId === chatId);
    if (index < 0) break;
    const [item] = pendingRuns.splice(index, 1);
    active.add(item.threadId);
    void item.run().finally(() => {
      active.delete(item.threadId);
      if (
        active.size === 0 &&
        !pendingRuns.some((run) => run.chatId === chatId)
      ) {
        activeRunsByChat.delete(chatId);
      }
      drainRuns(chatId);
    });
  }
}

function watchEntitlement(
  threadId: string,
  controller: AbortController,
): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    if (isDyadProEnabled(readSettings())) return;
    clearInterval(timer);
    controller.abort();
    void finishThread(
      threadId,
      "entitlement_revoked",
      null,
      "Dyad Pro entitlement was revoked while this sub-agent was running.",
    );
  }, 500);
  return timer;
}
