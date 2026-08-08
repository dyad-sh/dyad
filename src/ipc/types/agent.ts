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
 * Schema for agent tool consent request payload.
 */
export const AgentToolConsentRequestSchema = z.object({
  requestId: z.string(),
  chatId: z.number(),
  toolName: z.string(),
  toolDescription: z.string().nullable().optional(),
  inputPreview: z.string().nullable().optional(),
});

export type AgentToolConsentRequestPayload = z.infer<
  typeof AgentToolConsentRequestSchema
>;

/**
 * Schema for agent tool consent decision.
 */
export const AgentToolConsentDecisionSchema = z.enum([
  "accept-once",
  "accept-always",
  "decline",
]);

export type AgentToolConsentDecision = z.infer<
  typeof AgentToolConsentDecisionSchema
>;

/**
 * Schema for agent tool consent response params.
 */
export const AgentToolConsentResponseParamsSchema = z.object({
  requestId: z.string(),
  decision: AgentToolConsentDecisionSchema,
});

export type AgentToolConsentResponseParams = z.infer<
  typeof AgentToolConsentResponseParamsSchema
>;

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

  respondToConsent: defineContract({
    channel: "agent-tool:consent-response",
    input: AgentToolConsentResponseParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// Agent Event Contracts (Main -> Renderer)
// =============================================================================

export const agentEvents = {
  /**
   * Emitted when the agent needs consent for a tool invocation.
   */
  consentRequest: defineEvent({
    channel: "agent-tool:consent-request",
    payload: AgentToolConsentRequestSchema,
  }),

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
