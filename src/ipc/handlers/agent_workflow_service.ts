import log from "electron-log";
import { sql, eq, and, asc, desc } from "drizzle-orm";
import { db } from "@/db";
import {
  agent_execution_logs,
  agent_todos,
  agent_workflows,
} from "@/db/schema";
import type {
  AgentAnalysis,
  AgentExecutionLog,
  AgentExecutionLogType,
  AgentPlan,
  AgentTodo,
  AgentTodoUpdate,
  AgentWorkflow,
  AgentWorkflowStatus,
} from "@/agents/dayd/types";
import {
  AgentAnalysisSchema,
  AgentExecutionLogSchema,
  AgentExecutionLogTypeSchema,
  AgentPlanSchema,
  AgentPlanTodoInputSchema,
  AgentTodoSchema,
  AgentTodoStatusSchema,
  AgentTodoUpdateSchema,
  AgentWorkflowSchema,
  AgentWorkflowStatusSchema,
} from "@/agents/dayd/types";

const logger = log.scope("agent-workflow-service");

type AgentWorkflowRow = typeof agent_workflows.$inferSelect;
type AgentTodoRow = typeof agent_todos.$inferSelect;
type AgentExecutionLogRow = typeof agent_execution_logs.$inferSelect;

type WorkflowWithDetails = {
  workflow: AgentWorkflowRow;
  todos: AgentTodoRow[];
  logs: AgentExecutionLogRow[];
};

function safeParseJson<T>(value: unknown, fallback: T): T {
  if (typeof value === "string" && value.length) {
    try {
      return JSON.parse(value) as T;
    } catch (error) {
      logger.warn("Failed to parse JSON value", error);
    }
  } else if (value && typeof value === "object") {
    return value as T;
  }
  return fallback;
}

function mapTodoRow(row: AgentTodoRow): AgentTodo {
  const parsed = AgentTodoSchema.parse({
    id: row.id,
    workflowId: row.workflowId,
    todoId: row.todoId,
    title: row.title,
    description: row.description ?? undefined,
    owner: row.owner ?? undefined,
    inputs: safeParseJson<string[]>(row.inputs, []),
    outputs: safeParseJson<string[]>(row.outputs, []),
    completionCriteria: row.completionCriteria ?? undefined,
    status: AgentTodoStatusSchema.parse(row.status ?? "pending"),
    dyadTagRefs: safeParseJson<string[]>(row.dyadTagRefs, []),
    orderIndex: row.orderIndex,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return parsed;
}

function mapLogRow(row: AgentExecutionLogRow): AgentExecutionLog {
  const parsed = AgentExecutionLogSchema.parse({
    id: row.id,
    workflowId: row.workflowId,
    todoId: row.todoId ?? null,
    todoKey: row.todoKey ?? null,
    logType: AgentExecutionLogTypeSchema.parse(row.logType),
    content: row.content,
    dyadTagRefs: safeParseJson<string[]>(row.dyadTagRefs, []),
    metadata: safeParseJson<Record<string, unknown>>(row.metadata, {}),
    createdAt: row.createdAt,
  });
  return parsed;
}

function mapWorkflowRows({
  workflow,
  todos,
  logs,
}: WorkflowWithDetails): AgentWorkflow {
  const analysis = workflow.analysis
    ? AgentAnalysisSchema.safeParse(
        safeParseJson<AgentAnalysis>(workflow.analysis, {
          goals: [],
          constraints: [],
          acceptanceCriteria: [],
          risks: [],
          clarifications: [],
          dyadTagRefs: [],
        }),
      ).data
    : undefined;

  const mappedTodos = todos
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map(mapTodoRow)
    .map((todo) => ({ ...todo, logs: [] }));

  const mappedLogs = logs
    .sort((a, b) => (a.createdAt?.valueOf() ?? 0) - (b.createdAt?.valueOf() ?? 0))
    .map(mapLogRow);

  const todoLogsMap = new Map<number, AgentExecutionLog[]>();
  for (const log of mappedLogs) {
    if (typeof log.todoId === "number") {
      if (!todoLogsMap.has(log.todoId)) {
        todoLogsMap.set(log.todoId, []);
      }
      todoLogsMap.get(log.todoId)!.push(log);
    }
  }

  const todosWithLogs = mappedTodos.map((todo) => ({
    ...todo,
    logs: todoLogsMap.get(todo.id) ?? [],
    isActive: workflow.currentTodoId === todo.todoId,
  }));

  const workflowStatus = AgentWorkflowStatusSchema.safeParse(workflow.status);

  const dyadTagContext = safeParseJson<string[]>(workflow.dyadTagContext, []);

  const agentWorkflow = AgentWorkflowSchema.parse({
    id: workflow.id,
    chatId: workflow.chatId,
    status: workflowStatus.success ? workflowStatus.data : "idle",
    planVersion: workflow.planVersion ?? 0,
    currentTodoId: workflow.currentTodoId ?? null,
    autoAdvance: Boolean(workflow.autoAdvance),
    analysis: analysis ?? null,
    todos: todosWithLogs,
    logs: mappedLogs,
    dyadTagContext,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  });

  return agentWorkflow;
}

async function loadWorkflowWithDetails(workflowId: number): Promise<WorkflowWithDetails | null> {
  const workflow = await db.query.agent_workflows.findFirst({
    where: eq(agent_workflows.id, workflowId),
  });
  if (!workflow) return null;

  const todos = await db.query.agent_todos.findMany({
    where: eq(agent_todos.workflowId, workflowId),
    orderBy: (fields, { asc: orderAsc }) => [orderAsc(fields.orderIndex)],
  });
  const logs = await db.query.agent_execution_logs.findMany({
    where: eq(agent_execution_logs.workflowId, workflowId),
    orderBy: (fields, { asc: orderAsc }) => [orderAsc(fields.createdAt)],
  });

  return { workflow, todos, logs };
}

export async function ensureAgentWorkflow(chatId: number): Promise<AgentWorkflowRow> {
  const existing = await db.query.agent_workflows.findFirst({
    where: eq(agent_workflows.chatId, chatId),
  });
  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(agent_workflows)
    .values({
      chatId,
      status: "idle",
      planVersion: 0,
      currentTodoId: null,
      autoAdvance: false,
      analysis: null,
      dyadTagContext: JSON.stringify([]),
    })
    .returning();

  logger.log(`Created agent workflow for chat ${chatId}`, created?.id);
  return created;
}

export async function getAgentWorkflowStateByChatId(
  chatId: number,
): Promise<AgentWorkflow | null> {
  const workflow = await db.query.agent_workflows.findFirst({
    where: eq(agent_workflows.chatId, chatId),
  });
  if (!workflow) return null;

  const details = await loadWorkflowWithDetails(workflow.id);
  if (!details) return null;

  return mapWorkflowRows(details);
}

export async function getAgentWorkflowById(
  workflowId: number,
): Promise<AgentWorkflow | null> {
  const details = await loadWorkflowWithDetails(workflowId);
  if (!details) return null;
  return mapWorkflowRows(details);
}

export async function setAgentWorkflowStatus(
  workflowId: number,
  status: AgentWorkflowStatus,
): Promise<void> {
  const parsed = AgentWorkflowStatusSchema.parse(status);
  await db
    .update(agent_workflows)
    .set({ status: parsed, updatedAt: sql`(unixepoch())` })
    .where(eq(agent_workflows.id, workflowId));
}

export async function updateAgentAnalysis(
  workflowId: number,
  analysis: AgentAnalysis,
): Promise<void> {
  const parsed = AgentAnalysisSchema.parse(analysis);
  await db
    .update(agent_workflows)
    .set({
      analysis: JSON.stringify(parsed),
      status: "analysis",
      updatedAt: sql`(unixepoch())`,
    })
    .where(eq(agent_workflows.id, workflowId));
}

function normalizePlan(plan: AgentPlan): AgentPlan {
  const parsed = AgentPlanSchema.parse(plan);
  const todos = parsed.todos.map((todo, index) => {
    const todoParsed = AgentPlanTodoInputSchema.parse(todo);
    return {
      ...todoParsed,
      status: AgentTodoStatusSchema.parse(todoParsed.status ?? "pending"),
      orderIndex: index,
    };
  });
  return { ...parsed, todos };
}

export async function replaceAgentPlan(
  workflowId: number,
  plan: AgentPlan,
  opts: {
    status?: AgentWorkflowStatus;
  } = {},
): Promise<void> {
  const normalized = normalizePlan(plan);
  const workflow = await db.query.agent_workflows.findFirst({
    where: eq(agent_workflows.id, workflowId),
  });
  if (!workflow) {
    throw new Error(`Workflow ${workflowId} not found when replacing plan`);
  }

  await db.transaction(async (tx) => {
    await tx.delete(agent_todos).where(eq(agent_todos.workflowId, workflowId));

    if (normalized.todos.length) {
      await tx.insert(agent_todos).values(
        normalized.todos.map((todo, index) => ({
          workflowId,
          todoId: todo.todoId,
          title: todo.title,
          description: todo.description ?? null,
          owner: todo.owner ?? null,
          inputs: JSON.stringify(todo.inputs ?? []),
          outputs: JSON.stringify(todo.outputs ?? []),
          completionCriteria: todo.completionCriteria ?? null,
          status: todo.status ?? "pending",
          dyadTagRefs: JSON.stringify(todo.dyadTagRefs ?? []),
          orderIndex: index,
        })),
      );
    }

    await tx
      .update(agent_workflows)
      .set({
        planVersion: normalized.version ?? (workflow.planVersion ?? 0) + 1,
        status: opts.status ?? "plan_ready",
        currentTodoId: null,
        dyadTagContext: JSON.stringify(normalized.dyadTagContext ?? []),
        updatedAt: sql`(unixepoch())`,
      })
      .where(eq(agent_workflows.id, workflowId));
  });
}

export async function setAgentCurrentTodo(
  workflowId: number,
  todoId: string | null,
): Promise<void> {
  await db
    .update(agent_workflows)
    .set({ currentTodoId: todoId, updatedAt: sql`(unixepoch())` })
    .where(eq(agent_workflows.id, workflowId));
}

export async function applyAgentTodoUpdates(
  workflowId: number,
  updates: AgentTodoUpdate[],
): Promise<void> {
  if (!updates.length) return;
  const parsedUpdates = updates.map((update) => AgentTodoUpdateSchema.parse(update));
  await db.transaction(async (tx) => {
    for (const update of parsedUpdates) {
      const todoRow = await tx.query.agent_todos.findFirst({
        where: and(
          eq(agent_todos.workflowId, workflowId),
          eq(agent_todos.todoId, update.todoId),
        ),
      });
      if (!todoRow) {
        logger.warn(`Todo ${update.todoId} missing for workflow ${workflowId}`);
        continue;
      }
      await tx
        .update(agent_todos)
        .set({
          status: update.status ?? todoRow.status,
          dyadTagRefs: update.dyadTagRefs
            ? JSON.stringify(update.dyadTagRefs)
            : todoRow.dyadTagRefs,
          updatedAt: sql`(unixepoch())`,
        })
        .where(eq(agent_todos.id, todoRow.id));
    }
  });
}

export async function appendAgentLog(
  workflowId: number,
  log: {
    todoId?: string | null;
    todoKey?: string | null;
    logType: AgentExecutionLogType;
    content: string;
    dyadTagRefs?: string[];
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const parsedType = AgentExecutionLogTypeSchema.parse(log.logType);
  let todoRowId: number | null = null;
  if (log.todoId) {
    const todoRow = await db.query.agent_todos.findFirst({
      where: and(
        eq(agent_todos.workflowId, workflowId),
        eq(agent_todos.todoId, log.todoId),
      ),
    });
    todoRowId = todoRow?.id ?? null;
  }

  await db.insert(agent_execution_logs).values({
    workflowId,
    todoId: todoRowId,
    todoKey: log.todoKey ?? log.todoId ?? null,
    logType: parsedType,
    content: log.content,
    dyadTagRefs: JSON.stringify(log.dyadTagRefs ?? []),
    metadata: log.metadata ? JSON.stringify(log.metadata) : null,
  });
}

export async function setAgentAutoAdvance(
  workflowId: number,
  enabled: boolean,
): Promise<void> {
  await db
    .update(agent_workflows)
    .set({ autoAdvance: enabled, updatedAt: sql`(unixepoch())` })
    .where(eq(agent_workflows.id, workflowId));
}

export async function getWorkflowRowByChatId(
  chatId: number,
): Promise<AgentWorkflowRow | null> {
  const row = await db.query.agent_workflows.findFirst({
    where: eq(agent_workflows.chatId, chatId),
  });
  return row ?? null;
}

export async function removeAgentWorkflowData(chatId: number): Promise<void> {
  const workflow = await db.query.agent_workflows.findFirst({
    where: eq(agent_workflows.chatId, chatId),
  });
  if (!workflow) return;
  await db.transaction(async (tx) => {
    await tx.delete(agent_execution_logs).where(eq(agent_execution_logs.workflowId, workflow.id));
    await tx.delete(agent_todos).where(eq(agent_todos.workflowId, workflow.id));
    await tx.delete(agent_workflows).where(eq(agent_workflows.id, workflow.id));
  });
}
