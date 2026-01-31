import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";

// =============================================================================
// MCP Schemas
// =============================================================================

export const McpTransportEnum = z.enum(["stdio", "sse", "http"]);
export type McpTransport = z.infer<typeof McpTransportEnum>;

export const McpServerSchema = z.object({
  id: z.number(),
  name: z.string(),
  transport: McpTransportEnum,
  command: z.string().nullable(),
  args: z.array(z.string()).nullable(),
  envJson: z.record(z.string(), z.string()).nullable(),
  headersJson: z.record(z.string(), z.string()).nullable(),
  url: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type McpServer = z.infer<typeof McpServerSchema>;

export const CreateMcpServerSchema = z.object({
  name: z.string(),
  transport: McpTransportEnum.default("stdio"),
  command: z.string().nullable().optional(),
  args: z
    .union([z.array(z.string()), z.string()])
    .nullable()
    .optional(),
  envJson: z
    .union([z.record(z.string(), z.string()), z.string()])
    .nullable()
    .optional(),
  headersJson: z
    .union([z.record(z.string(), z.string()), z.string()])
    .nullable()
    .optional(),
  url: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
});

export type CreateMcpServer = z.infer<typeof CreateMcpServerSchema>;

export const McpServerUpdateSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  transport: McpTransportEnum.optional(),
  command: z.string().optional(),
  args: z.string().optional(),
  cwd: z.string().optional(),
  envJson: z.union([z.record(z.string(), z.string()), z.string()]).optional(),
  headersJson: z
    .union([z.record(z.string(), z.string()), z.string()])
    .optional(),
  url: z.string().optional(),
  enabled: z.boolean().optional(),
});

export type McpServerUpdate = z.infer<typeof McpServerUpdateSchema>;

export const McpConsentEnum = z.enum(["ask", "always", "denied"]);
export type McpConsentValue = z.infer<typeof McpConsentEnum>;

export const McpToolSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  consent: McpConsentEnum.optional(),
});

export type McpTool = z.infer<typeof McpToolSchema>;

export const McpToolConsentRecordSchema = z.object({
  id: z.number(),
  serverId: z.number(),
  toolName: z.string(),
  consent: McpConsentEnum,
  updatedAt: z.date(),
});

export type McpToolConsent = z.infer<typeof McpToolConsentRecordSchema>;

export const SetMcpToolConsentParamsSchema = z.object({
  serverId: z.number(),
  toolName: z.string(),
  consent: McpConsentEnum,
});

export type SetMcpToolConsentParams = z.infer<
  typeof SetMcpToolConsentParamsSchema
>;

export const McpConsentRequestSchema = z.object({
  requestId: z.string(),
  serverId: z.number(),
  serverName: z.string(),
  toolName: z.string(),
  toolDescription: z.string().nullable().optional(),
  inputPreview: z.string().nullable().optional(),
});

export type McpConsentRequestPayload = z.infer<typeof McpConsentRequestSchema>;

export const McpConsentDecisionEnum = z.enum([
  "accept-once",
  "accept-always",
  "decline",
]);
export type McpConsentDecision = z.infer<typeof McpConsentDecisionEnum>;

export const McpConsentResponseSchema = z.object({
  requestId: z.string(),
  decision: McpConsentDecisionEnum,
});

export type McpConsentResponseParams = z.infer<typeof McpConsentResponseSchema>;

// =============================================================================
// MCP Contracts
// =============================================================================

export const mcpContracts = {
  listServers: defineContract({
    channel: "mcp:list-servers",
    input: z.void(),
    output: z.array(McpServerSchema),
  }),

  createServer: defineContract({
    channel: "mcp:create-server",
    input: CreateMcpServerSchema,
    output: McpServerSchema,
  }),

  updateServer: defineContract({
    channel: "mcp:update-server",
    input: McpServerUpdateSchema,
    output: McpServerSchema,
  }),

  deleteServer: defineContract({
    channel: "mcp:delete-server",
    input: z.number(), // serverId
    output: z.object({ success: z.boolean() }),
  }),

  listTools: defineContract({
    channel: "mcp:list-tools",
    input: z.number(), // serverId
    output: z.array(McpToolSchema),
  }),

  getToolConsents: defineContract({
    channel: "mcp:get-tool-consents",
    input: z.void(),
    output: z.array(McpToolConsentRecordSchema),
  }),

  setToolConsent: defineContract({
    channel: "mcp:set-tool-consent",
    input: SetMcpToolConsentParamsSchema,
    output: McpToolConsentRecordSchema,
  }),

  respondToConsent: defineContract({
    channel: "mcp:tool-consent-response",
    input: McpConsentResponseSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// MCP Event Contracts
// =============================================================================

export const mcpEvents = {
  consentRequest: defineEvent({
    channel: "mcp:tool-consent-request",
    payload: McpConsentRequestSchema,
  }),
} as const;

// =============================================================================
// MCP Clients
// =============================================================================

export const mcpClient = createClient(mcpContracts);
export const mcpEventClient = createEventClient(mcpEvents);
