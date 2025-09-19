import { z } from "zod";

export const AgentTodoStatusSchema = z.enum([
  "pending",
  "ready",
  "in_progress",
  "completed",
  "blocked",
  "revising",
]);
export type AgentTodoStatus = z.infer<typeof AgentTodoStatusSchema>;

export const AgentWorkflowStatusSchema = z.enum([
  "idle",
  "analysis",
  "plan_ready",
  "executing",
  "awaiting_user",
  "reviewing",
  "completed",
  "revising",
  "error",
]);
export type AgentWorkflowStatus = z.infer<typeof AgentWorkflowStatusSchema>;

export const AgentExecutionLogTypeSchema = z.enum([
  "analysis",
  "plan",
  "execution",
  "review",
  "command",
  "validation",
  "system",
]);
export type AgentExecutionLogType = z.infer<typeof AgentExecutionLogTypeSchema>;

export const AgentAnalysisSchema = z.object({
  goals: z.array(z.string()).default([]),
  constraints: z.array(z.string()).default([]),
  acceptanceCriteria: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  clarifications: z.array(z.string()).default([]),
  dyadTagRefs: z.array(z.string()).default([]),
});
export type AgentAnalysis = z.infer<typeof AgentAnalysisSchema>;

export const AgentTodoSchema = z.object({
  id: z.number(),
  workflowId: z.number(),
  todoId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  owner: z.string().optional(),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  completionCriteria: z.string().optional(),
  status: AgentTodoStatusSchema,
  dyadTagRefs: z.array(z.string()).default([]),
  orderIndex: z.number(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});
export type AgentTodo = z.infer<typeof AgentTodoSchema>;

export const AgentExecutionLogSchema = z.object({
  id: z.number(),
  workflowId: z.number(),
  todoId: z.number().nullable(),
  todoKey: z.string().nullable().optional(),
  logType: AgentExecutionLogTypeSchema,
  content: z.string(),
  dyadTagRefs: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.any()).optional(),
  createdAt: z.coerce.date(),
});
export type AgentExecutionLog = z.infer<typeof AgentExecutionLogSchema>;

export const AgentTodoPublicSchema = AgentTodoSchema.extend({
  logs: z.array(AgentExecutionLogSchema).default([]),
  isActive: z.boolean().default(false),
});
export type AgentTodoPublic = z.infer<typeof AgentTodoPublicSchema>;

export const AgentPlanTodoInputSchema = z.object({
  todoId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  owner: z.string().optional(),
  inputs: z.array(z.string()).default([]),
  outputs: z.array(z.string()).default([]),
  completionCriteria: z.string().optional(),
  status: AgentTodoStatusSchema.optional(),
  dyadTagRefs: z.array(z.string()).default([]),
});
export type AgentPlanTodoInput = z.infer<typeof AgentPlanTodoInputSchema>;

export const AgentPlanSchema = z.object({
  version: z.number().optional(),
  todos: z.array(AgentPlanTodoInputSchema),
  dyadTagRefs: z.array(z.string()).default([]),
  dyadTagContext: z.array(z.string()).default([]),
});
export type AgentPlan = z.infer<typeof AgentPlanSchema>;

export const AgentTodoUpdateSchema = z.object({
  todoId: z.string(),
  status: AgentTodoStatusSchema.optional(),
  dyadTagRefs: z.array(z.string()).optional(),
  note: z.string().optional(),
});
export type AgentTodoUpdate = z.infer<typeof AgentTodoUpdateSchema>;

export const AgentWorkflowSchema = z.object({
  id: z.number(),
  chatId: z.number(),
  status: AgentWorkflowStatusSchema,
  planVersion: z.number().default(0),
  currentTodoId: z.string().nullable(),
  autoAdvance: z.boolean().default(false),
  analysis: AgentAnalysisSchema.nullable().optional(),
  todos: z.array(AgentTodoPublicSchema).default([]),
  logs: z.array(AgentExecutionLogSchema).default([]),
  dyadTagContext: z.array(z.string()).default([]),
  lastCommand: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
  createdAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
});
export type AgentWorkflow = z.infer<typeof AgentWorkflowSchema>;

export const AgentCommandSchema = z.object({
  kind: z.enum([
    "brief",
    "start",
    "continue",
    "revise",
    "change_plan",
    "switch_mode",
    "custom",
  ]),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type AgentCommand = z.infer<typeof AgentCommandSchema>;

export const AgentWorkflowSnapshotSchema = z.object({
  workflow: AgentWorkflowSchema,
  timestamp: z.coerce.date(),
});
export type AgentWorkflowSnapshot = z.infer<typeof AgentWorkflowSnapshotSchema>;
