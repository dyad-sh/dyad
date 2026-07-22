import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";
import type {
  ConnectionFlowProvider,
  ConnectionFlowState,
} from "../../connection_flow/state";

// =============================================================================
// Connection Flow Schemas
// =============================================================================

export const ConnectionFlowProviderSchema = z.enum([
  "github",
  "supabase",
  "neon",
]) satisfies z.ZodType<ConnectionFlowProvider>;

export const ConnectionFlowFailureReasonSchema = z.enum([
  "user_cancelled",
  "timeout",
  "token_invalid",
  "network",
]);

export const ConnectionFlowStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("disconnected") }),
  z.object({
    status: z.literal("starting"),
    flowId: z.string(),
    provider: ConnectionFlowProviderSchema,
  }),
  z.object({
    status: z.literal("awaiting-return"),
    flowId: z.string(),
    provider: ConnectionFlowProviderSchema,
    userCode: z.string().optional(),
    verificationUri: z.string().optional(),
  }),
  z.object({
    status: z.literal("exchanging-token"),
    flowId: z.string(),
    provider: ConnectionFlowProviderSchema,
  }),
  z.object({
    status: z.literal("loading-resources"),
    flowId: z.string(),
    provider: ConnectionFlowProviderSchema,
  }),
  z.object({
    status: z.literal("connected"),
    flowId: z.string(),
    provider: ConnectionFlowProviderSchema,
  }),
  z.object({
    status: z.literal("failed"),
    flowId: z.string(),
    provider: ConnectionFlowProviderSchema,
    reason: ConnectionFlowFailureReasonSchema,
    message: z.string().optional(),
  }),
  z.object({
    status: z.literal("cancelled"),
    flowId: z.string(),
    provider: ConnectionFlowProviderSchema,
  }),
]) satisfies z.ZodType<ConnectionFlowState>;

const FlowIdParamsSchema = z.object({
  provider: ConnectionFlowProviderSchema,
  flowId: z.string(),
});

// =============================================================================
// Connection Flow Contracts
// =============================================================================

export const connectionFlowContracts = {
  start: defineContract({
    channel: "connection-flow:start",
    input: z.object({
      provider: ConnectionFlowProviderSchema,
      appId: z.number().nullable().optional(),
    }),
    output: z.object({
      flowId: z.string(),
      started: z.boolean(),
      state: ConnectionFlowStateSchema,
    }),
  }),

  cancel: defineContract({
    channel: "connection-flow:cancel",
    input: z.object({
      provider: ConnectionFlowProviderSchema,
      flowId: z.string().optional(),
    }),
    output: z.void(),
  }),

  resourcesLoaded: defineContract({
    channel: "connection-flow:resources-loaded",
    input: FlowIdParamsSchema,
    output: z.void(),
  }),

  acknowledge: defineContract({
    channel: "connection-flow:acknowledge",
    input: FlowIdParamsSchema,
    output: z.void(),
  }),

  getStates: defineContract({
    channel: "connection-flow:get-states",
    input: z.void(),
    output: z.object({
      github: ConnectionFlowStateSchema,
      supabase: ConnectionFlowStateSchema,
      neon: ConnectionFlowStateSchema,
    }),
  }),
} as const;

// =============================================================================
// Connection Flow Event Contracts
// =============================================================================

export const connectionFlowEvents = {
  stateChanged: defineEvent({
    channel: "connection-flow:state-changed",
    payload: z.object({
      provider: ConnectionFlowProviderSchema,
      state: ConnectionFlowStateSchema,
    }),
  }),

  /**
   * An OAuth return was processed (tokens written) with no matching active
   * flow — cold-start deep link, app restarted mid-flow, or a return that
   * lost the race against a timeout. The renderer should refresh connection
   * state without transitioning any flow.
   */
  unsolicitedReturn: defineEvent({
    channel: "connection-flow:unsolicited-return",
    payload: z.object({
      provider: ConnectionFlowProviderSchema,
    }),
  }),
} as const;

// =============================================================================
// Connection Flow Clients
// =============================================================================

export const connectionFlowClient = createClient(connectionFlowContracts);
export const connectionFlowEventClient =
  createEventClient(connectionFlowEvents);
