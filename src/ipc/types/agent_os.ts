import { z } from "zod";
import {
  defineContract,
  defineStream,
  createClient,
  createStreamClient,
} from "../contracts/core";

// =============================================================================
// Agent OS Schemas
// =============================================================================

export const AgentOsTypeSchema = z.enum([
  "Hermes",
  "OpenClaw",
  "MCP",
  "Custom",
]);
export type AgentOsType = z.infer<typeof AgentOsTypeSchema>;

export const AgentOsStatusSchema = z.enum([
  "online",
  "idle",
  "offline",
  "error",
]);
export type AgentOsStatus = z.infer<typeof AgentOsStatusSchema>;

/**
 * Agent record returned to the renderer. The raw API key is never included;
 * `hasApiKey` indicates whether one is stored locally.
 */
export const AgentOsAgentDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: AgentOsTypeSchema,
  endpoint: z.string(),
  imageBaseUrl: z.string(),
  model: z.string(),
  capabilities: z.array(z.string()),
  icon: z.string(),
  enabled: z.boolean(),
  status: AgentOsStatusSchema,
  taskCount: z.number(),
  hasApiKey: z.boolean(),
  lastActivityAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type AgentOsAgentDto = z.infer<typeof AgentOsAgentDtoSchema>;

export const CreateAgentOsAgentSchema = z.object({
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
  type: AgentOsTypeSchema.optional(),
  endpoint: z.string().optional(),
  imageBaseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  icon: z.string().optional(),
});
export type CreateAgentOsAgent = z.infer<typeof CreateAgentOsAgentSchema>;

export const UpdateAgentOsAgentSchema = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: AgentOsTypeSchema.optional(),
  endpoint: z.string().optional(),
  imageBaseUrl: z.string().optional(),
  model: z.string().optional(),
  // Empty string clears the stored key; undefined leaves it untouched.
  apiKey: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  icon: z.string().optional(),
});
export type UpdateAgentOsAgent = z.infer<typeof UpdateAgentOsAgentSchema>;

export const ToggleAgentOsAgentSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
});
export type ToggleAgentOsAgent = z.infer<typeof ToggleAgentOsAgentSchema>;

export const AgentOsChatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});
export type AgentOsChatMessage = z.infer<typeof AgentOsChatMessageSchema>;

export const AgentOsChatRequestSchema = z.object({
  agentId: z.string(),
  messages: z.array(AgentOsChatMessageSchema).min(1),
});
export type AgentOsChatRequest = z.infer<typeof AgentOsChatRequestSchema>;

export const AgentOsChatResponseSchema = z.object({
  content: z.string(),
  model: z.string(),
  images: z.array(z.string()).optional(),
});
export type AgentOsChatResponse = z.infer<typeof AgentOsChatResponseSchema>;

// --- Streaming chat ---
export const AgentOsChatStartSchema = z.object({
  streamId: z.string(),
  agentId: z.string(),
  messages: z.array(AgentOsChatMessageSchema).min(1),
});
export type AgentOsChatStart = z.infer<typeof AgentOsChatStartSchema>;

export const AgentOsChatChunkSchema = z.object({
  streamId: z.string(),
  delta: z.string(),
});

export const AgentOsChatEndSchema = z.object({
  streamId: z.string(),
  content: z.string(),
  model: z.string(),
  images: z.array(z.string()).optional(),
});

export const AgentOsChatStreamErrorSchema = z.object({
  streamId: z.string(),
  error: z.string(),
});

// =============================================================================
// Agent OS Contracts
// =============================================================================

export const agentOsContracts = {
  list: defineContract({
    channel: "agent-os:list",
    input: z.void(),
    output: z.array(AgentOsAgentDtoSchema),
  }),

  create: defineContract({
    channel: "agent-os:create",
    input: CreateAgentOsAgentSchema,
    output: AgentOsAgentDtoSchema,
  }),

  update: defineContract({
    channel: "agent-os:update",
    input: UpdateAgentOsAgentSchema,
    output: AgentOsAgentDtoSchema,
  }),

  toggle: defineContract({
    channel: "agent-os:toggle",
    input: ToggleAgentOsAgentSchema,
    output: AgentOsAgentDtoSchema,
  }),

  chat: defineContract({
    channel: "agent-os:chat",
    input: AgentOsChatRequestSchema,
    output: AgentOsChatResponseSchema,
  }),

  chatStart: defineContract({
    channel: "agent-os:chat:start",
    input: AgentOsChatStartSchema,
    output: z.object({ ok: z.literal(true) }),
  }),

  chatCancel: defineContract({
    channel: "agent-os:chat:cancel",
    input: z.string(), // streamId
    output: z.object({ ok: z.literal(true) }),
  }),

  delete: defineContract({
    channel: "agent-os:delete",
    input: z.string(), // id
    output: z.void(),
  }),
} as const;

// =============================================================================
// Agent OS Chat Stream Contract
// =============================================================================

export const agentOsChatStreamContract = defineStream({
  channel: "agent-os:chat:start",
  input: AgentOsChatStartSchema,
  keyField: "streamId",
  events: {
    chunk: {
      channel: "agent-os:chat:chunk",
      payload: AgentOsChatChunkSchema,
    },
    end: {
      channel: "agent-os:chat:end",
      payload: AgentOsChatEndSchema,
    },
    error: {
      channel: "agent-os:chat:error",
      payload: AgentOsChatStreamErrorSchema,
    },
  },
});

// =============================================================================
// Agent OS Clients
// =============================================================================

export const agentOsClient = createClient(agentOsContracts);
export const agentOsChatStreamClient = createStreamClient(
  agentOsChatStreamContract,
);
