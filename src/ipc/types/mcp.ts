import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";

// Arbitrary loopback port for the OAuth callback listener -- not from
// the OAuth or MCP specs. Must stay stable: users pre-registering an
// OAuth app at a provider (non-DCR servers) put
// `http://localhost:<this-port>/callback` into the redirect-URI field;
// changing this number invalidates their setup. Cost of one fixed
// port: only one OAuth flow at a time system-wide (the supersede in
// mcp_oauth_flow.ts handles concurrent attempts).
export const DEFAULT_OAUTH_CALLBACK_PORT = 53682;

// =============================================================================
// MCP Schemas
// =============================================================================

export const McpTransportEnum = z.enum(["stdio", "http"]);
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
  oauthEnabled: z.boolean(),
  // True if usable OAuth tokens are stored for this server. Drives the
  // Connected / Not connected badge without sending the token blob to
  // the renderer.
  oauthConnected: z.boolean(),
  // Null falls back to DEFAULT_OAUTH_CALLBACK_PORT.
  oauthCallbackPort: z.number().nullable(),
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
  oauthEnabled: z.boolean().optional(),
  oauthClientId: z.string().nullable().optional(),
  // Plaintext OAuth client_secret on create. The handler encrypts it
  // before storing and never returns it via `McpServerSchema`.
  oauthClientSecret: z.string().nullable().optional(),
  oauthScope: z.string().nullable().optional(),
  // Null falls back to DEFAULT_OAUTH_CALLBACK_PORT.
  oauthCallbackPort: z
    .number()
    .int()
    .min(1024)
    .max(65535)
    .nullable()
    .optional(),
});

export type CreateMcpServer = z.infer<typeof CreateMcpServerSchema>;

export const McpServerUpdateSchema = z.object({
  id: z.number(),
  name: z.string().optional(),
  transport: McpTransportEnum.optional(),
  command: z.string().optional(),
  args: z.string().optional(),
  envJson: z.union([z.record(z.string(), z.string()), z.string()]).optional(),
  headersJson: z
    .union([z.record(z.string(), z.string()), z.string()])
    .optional(),
  url: z.string().optional(),
  enabled: z.boolean().optional(),
  oauthEnabled: z.boolean().optional(),
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
  chatId: z.number(),
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

  startOAuth: defineContract({
    channel: "mcp:start-oauth",
    input: z.object({
      serverId: z.number(),
    }),
    output: z.object({
      success: z.boolean(),
      // Set when `success` is false; shown to the user as a toast in
      // `ToolsMcpSettings`.
      error: z.string().nullable(),
      errorKind: z.enum(["discovery_failed", "other"]).nullable().optional(),
    }),
  }),

  disconnectOAuth: defineContract({
    channel: "mcp:disconnect-oauth",
    input: z.number(), // serverId
    output: z.object({ success: z.boolean() }),
  }),

  probeCallbackPort: defineContract({
    channel: "mcp:probe-callback-port",
    input: z.void(),
    output: z.object({ port: z.number().int() }),
  }),

  probeConnection: defineContract({
    channel: "mcp:probe-connection",
    input: z.number(), // serverId
    output: z.object({
      status: z.enum(["ok", "unauthorized", "error"]),
      error: z.string().nullable(),
    }),
  }),

  // Reports whether the OS keyring is available. When false, OAuth
  // tokens fall back to plaintext storage in SQLite -- the renderer
  // surfaces a banner so users know the security degradation.
  isOauthStorageEncrypted: defineContract({
    channel: "mcp:is-oauth-storage-encrypted",
    input: z.void(),
    output: z.object({ available: z.boolean() }),
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
