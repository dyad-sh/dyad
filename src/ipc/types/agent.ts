import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";
import { AgentToolConsentSchema } from "../../lib/schemas";

// =============================================================================
// Agent Schemas
// =============================================================================

/**
 * Schema for agent todo item.
 */
export const AgentTodoSchema = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]),
});

export type AgentTodo = z.infer<typeof AgentTodoSchema>;

/**
 * Schema for agent todos update payload.
 */
export const AgentTodosUpdateSchema = z.object({
  chatId: z.number(),
  todos: z.array(AgentTodoSchema),
});

export type AgentTodosUpdatePayload = z.infer<typeof AgentTodosUpdateSchema>;

/**
 * Schema for problem item (from tsc).
 * Matches the Problem interface in shared/tsc_types.ts
 */
export const ProblemSchema = z.object({
  file: z.string(),
  line: z.number(),
  column: z.number(),
  message: z.string(),
  code: z.number(),
  snippet: z.string(),
});

export type Problem = z.infer<typeof ProblemSchema>;

/**
 * Schema for problem report.
 * Matches the ProblemReport interface in shared/tsc_types.ts
 */
export const ProblemReportSchema = z.object({
  problems: z.array(ProblemSchema),
  outcome: z.enum(["passed", "errors", "incomplete"]).optional(),
});

export type ProblemReport = z.infer<typeof ProblemReportSchema>;

/**
 * Schema for agent problems update payload.
 */
export const AgentProblemsUpdateSchema = z.object({
  appId: z.number(),
  problems: ProblemReportSchema,
});

export type AgentProblemsUpdatePayload = z.infer<
  typeof AgentProblemsUpdateSchema
>;

/**
 * Schema for agent tool info.
 */
export const AgentToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  isAllowedByDefault: z.boolean(),
  consent: AgentToolConsentSchema,
});

export type AgentTool = z.infer<typeof AgentToolSchema>;

/**
 * Schema for set agent tool consent params.
 */
export const SetAgentToolConsentParamsSchema = z.object({
  toolName: z.string(),
  consent: AgentToolConsentSchema,
});

export type SetAgentToolConsentParams = z.infer<
  typeof SetAgentToolConsentParamsSchema
>;

export const SubagentPersonaSchema = z.enum([
  "explorer",
  "reviewer",
  "implementer",
]);
export type SubagentPersona = z.infer<typeof SubagentPersonaSchema>;

export const SubagentStatusSchema = z.enum([
  "queued",
  "running",
  "stopping",
  "waiting_for_writer",
  "auto_fix_countdown",
  "fixing_findings",
  "completed",
  "partial",
  "review_outdated",
  "cancelled",
  "entitlement_revoked",
  "interrupted_by_restart",
  "failed",
]);
export type SubagentStatus = z.infer<typeof SubagentStatusSchema>;

// Keep the pure lifecycle machine's hand-written domain status in lockstep
// with this wire schema without importing Zod into state.ts.
type LifecycleSubagentStatus =
  import("@/pro/main/ipc/handlers/local_agent/subagents/state").SubagentStatus;
type _WireStatusCoversLifecycle = SubagentStatus extends LifecycleSubagentStatus
  ? true
  : never;
type _LifecycleStatusCoversWire = LifecycleSubagentStatus extends SubagentStatus
  ? true
  : never;
const _subagentStatusMutualAssignability: [
  _WireStatusCoversLifecycle,
  _LifecycleStatusCoversWire,
] = [true, true];
void _subagentStatusMutualAssignability;

export const SUBAGENT_ACTIVE_STATUSES = [
  "queued",
  "running",
  "stopping",
  "waiting_for_writer",
] as const satisfies readonly SubagentStatus[];

export function isSubagentActive(status: SubagentStatus): boolean {
  return (SUBAGENT_ACTIVE_STATUSES as readonly SubagentStatus[]).includes(
    status,
  );
}

export function isSubagentAcceptingMessages(status: SubagentStatus): boolean {
  return status !== "stopping" && isSubagentActive(status);
}

export const SubagentThreadSummarySchema = z.object({
  id: z.string(),
  chatId: z.number(),
  persona: SubagentPersonaSchema,
  taskName: z.string(),
  assignment: z.string(),
  status: SubagentStatusSchema,
  provider: z.string(),
  model: z.string(),
  reasoningEffort: z.string(),
  result: z.record(z.string(), z.unknown()).nullable(),
  reviewBaseCommit: z.string().nullable(),
  reviewTargetCommit: z.string().nullable(),
  reviewDiffHash: z.string().nullable(),
  sourceMessageId: z.number().nullable(),
  invocationSource: z.enum([
    "model",
    "review_button",
    "auto_review",
    "followup",
  ]),
  remediationSource: z
    .enum(["fix_button", "auto_fix", "queued_message_override"])
    .nullable(),
  autoFixAt: z.date().nullable(),
  error: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  toolCallCount: z.number(),
  createdAt: z.date(),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  updatedAt: z.date(),
});
export type SubagentThreadSummary = z.infer<typeof SubagentThreadSummarySchema>;

export const SubagentMessageSchema = z.object({
  id: z.number(),
  threadId: z.string(),
  sequence: z.number(),
  messageId: z.string(),
  role: z.enum(["root", "assistant", "system"]),
  content: z.string(),
  consumed: z.boolean(),
  createdAt: z.date(),
});
export type SubagentMessage = z.infer<typeof SubagentMessageSchema>;

export const SubagentActivitySchema = z.object({
  id: z.number(),
  threadId: z.string(),
  sequence: z.number(),
  toolCallId: z.string(),
  toolName: z.string(),
  status: z.enum(["pending", "completed", "error", "aborted"]),
  presentationXml: z.string(),
  error: z.string().nullable(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
});
export type SubagentActivity = z.infer<typeof SubagentActivitySchema>;

// =============================================================================
// Agent Contracts (Invoke/Response)
// =============================================================================

export const agentContracts = {
  getTools: defineContract({
    channel: "agent-tool:get-tools",
    input: z.void(),
    output: z.array(AgentToolSchema),
  }),

  setConsent: defineContract({
    channel: "agent-tool:set-consent",
    input: SetAgentToolConsentParamsSchema,
    output: z.void(),
  }),
  listSubagents: defineContract({
    channel: "agent:list-subagents",
    input: z.object({ chatId: z.number() }),
    output: z.array(SubagentThreadSummarySchema),
  }),

  getSubagentMessages: defineContract({
    channel: "agent:get-subagent-messages",
    input: z.object({ chatId: z.number(), threadId: z.string() }),
    output: z.array(SubagentMessageSchema),
  }),

  getSubagentActivities: defineContract({
    channel: "agent:get-subagent-activities",
    input: z.object({ chatId: z.number(), threadId: z.string() }),
    output: z.array(SubagentActivitySchema),
  }),

  sendSubagentMessage: defineContract({
    channel: "agent:send-subagent-message",
    input: z.object({
      chatId: z.number(),
      threadId: z.string(),
      message: z.string().min(1).max(20_000),
    }),
    output: z.void(),
  }),

  followupSubagent: defineContract({
    channel: "agent:followup-subagent",
    input: z.object({
      chatId: z.number(),
      threadId: z.string(),
      message: z.string().min(1).max(20_000),
    }),
    output: SubagentPersonaSchema,
  }),

  startReview: defineContract({
    channel: "agent:start-review",
    input: z.object({ chatId: z.number(), sourceMessageId: z.number() }),
    output: SubagentThreadSummarySchema,
  }),

  runAutoReviewBarrier: defineContract({
    channel: "agent:run-auto-review-barrier",
    input: z.object({
      chatId: z.number(),
      verification: z.boolean().optional(),
      autoFix: z.boolean().optional(),
    }),
    output: z.object({
      outcome: z.enum([
        "released",
        "skipped",
        "waiting",
        "fix_required",
        "verification_failed",
      ]),
      threadId: z.string().optional(),
      prompt: z.string().optional(),
    }),
  }),

  fixReviewFindings: defineContract({
    channel: "agent:fix-review-findings",
    input: z.object({ chatId: z.number(), threadId: z.string() }),
    output: z.object({ prompt: z.string() }),
  }),

  skipReviewAutoFix: defineContract({
    channel: "agent:skip-review-auto-fix",
    input: z.object({
      chatId: z.number(),
      threadId: z.string(),
      remediationFailed: z.boolean().optional(),
    }),
    output: z.void(),
  }),

  cancelSubagent: defineContract({
    channel: "agent:cancel-subagent",
    input: z.object({ chatId: z.number(), threadId: z.string() }),
    output: z.void(),
  }),
} as const;

// =============================================================================
// Agent Event Contracts (Main -> Renderer)
// =============================================================================

export const agentEvents = {
  /**
   * Emitted when the agent's todo list is updated.
   */
  todosUpdate: defineEvent({
    channel: "agent-tool:todos-update",
    payload: AgentTodosUpdateSchema,
  }),

  /**
   * Emitted when the agent's problems report is updated.
   */
  problemsUpdate: defineEvent({
    channel: "agent-tool:problems-update",
    payload: AgentProblemsUpdateSchema,
  }),

  subagentUpdate: defineEvent({
    channel: "agent:subagent-update",
    payload: z.object({ chatId: z.number(), threadId: z.string() }),
  }),
} as const;

// =============================================================================
// Agent Clients
// =============================================================================

/**
 * Type-safe client for agent IPC operations.
 *
 * @example
 * const tools = await agentClient.getTools();
 * await agentClient.setConsent({ toolName: "file_write", consent: "always" });
 */
export const agentClient = createClient(agentContracts);

/**
 * Type-safe event client for agent events.
 *
 * @example
 * const unsubscribe = agentEventClient.onConsentRequest((payload) => {
 *   showConsentDialog(payload);
 * });
 * // Later: unsubscribe();
 */
export const agentEventClient = createEventClient(agentEvents);
