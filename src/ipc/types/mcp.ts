import { z } from "zod";
import { McpCatalogEntrySchema } from "./mcp_catalog";
import { defineContract, createClient } from "../contracts/core";

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

export const McpTransportEnum = z.enum(["stdio", "sse", "http"]);
export type McpTransport = z.infer<typeof McpTransportEnum>;

// Names one configuration: a plugin's default (null `appConfigId`) or one
// of its app-specific configurations. See src/shared/mcp_connection_ref.ts.
export const McpConnectionRefSchema = z.object({
  serverId: z.number().int().positive(),
  appConfigId: z.number().int().positive().nullable(),
});

// Fields every connectable configuration has: a plugin's default
// configuration (McpServer) and an app-specific one (McpAppConfig). `id` is
// the row id in its own table. `connection` is what the per-configuration
// channels below (tools, OAuth, approvals) take.
export const McpConnectionConfigSchema = z.object({
  id: z.number(),
  connection: McpConnectionRefSchema,
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
  // Unreadable state requires an explicit reset before reconnecting.
  oauthUnreadable: z.boolean(),
  // Null falls back to DEFAULT_OAUTH_CALLBACK_PORT.
  oauthCallbackPort: z.number().nullable(),
  // Public OAuth client id (not a secret). Surfaced so the UI can tell
  // whether a pre-registered client has been configured; the secret is
  // never sent to the renderer.
  oauthClientId: z.string().nullable(),
  // True when the stored env vars or headers could not be decrypted.
  // Tracked per field so a broken value the server doesn't use can't
  // lock the editor for the one it does. The UI locks the matching
  // editor so a save can't replace real values with the empty list it
  // would otherwise show.
  envUnreadable: z.boolean(),
  headersUnreadable: z.boolean(),
  // Set when the server was added from the curated catalog. An
  // app-specific configuration reports its plugin's.
  catalogSlug: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type McpConnectionConfig = z.infer<typeof McpConnectionConfigSchema>;

export const PluginDefaultScopeSchema = z.enum(["all", "selected", "none"]);

export const McpServerSchema = McpConnectionConfigSchema.extend({
  // App-scoped plugins experiment; "all" with no app configurations when
  // it's off. Which apps the default configuration serves; see
  // mcp_plugin_availability.ts.
  defaultScope: PluginDefaultScopeSchema,
  defaultAppIds: z.array(z.number()),
  appConfigCount: z.number().int(),
});

export type McpServer = z.infer<typeof McpServerSchema>;

// An app-specific configuration of a plugin. `serverId` is its plugin, and
// `enabled` mirrors the plugin's switch.
export const McpAppConfigSchema = McpConnectionConfigSchema.extend({
  serverId: z.number(),
  appIds: z.array(z.number()),
});

export type McpAppConfig = z.infer<typeof McpAppConfigSchema>;

// OAuth scope tokens use only printable ASCII (no space, quote, or
// backslash), separated by single spaces. Catches typos like
// leading/trailing spaces, control chars, or quotes at validation time so
// they don't surface as opaque OAuth provider errors later. Empty string
// means "use the server's default scope".
const oauthScopeSchema = z
  .string()
  .regex(/^(?:[\x21\x23-\x5b\x5d-\x7e]+(?: [\x21\x23-\x5b\x5d-\x7e]+)*)?$/, {
    message: "OAuth scope contains invalid characters",
  })
  .nullable()
  .optional();

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
  oauthScope: oauthScopeSchema,
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

// Fields an edit can change on either kind of configuration.
const McpConnectionConfigUpdateFields = {
  name: z.string().optional(),
  transport: McpTransportEnum.optional(),
  command: z.string().optional(),
  args: z.string().optional(),
  envJson: z.union([z.record(z.string(), z.string()), z.string()]).optional(),
  headersJson: z
    .union([z.record(z.string(), z.string()), z.string()])
    .optional(),
  url: z.string().optional(),
  oauthEnabled: z.boolean().optional(),
  oauthClientId: z.string().nullable().optional(),
  // Plaintext on update; the handler encrypts it before storing and never
  // returns it via `McpServerSchema`.
  oauthClientSecret: z.string().nullable().optional(),
  oauthScope: oauthScopeSchema,
};

export const McpServerUpdateSchema = z.object({
  id: z.number().int().positive(),
  enabled: z.boolean().optional(),
  ...McpConnectionConfigUpdateFields,
});

export type McpServerUpdate = z.infer<typeof McpServerUpdateSchema>;

// An app-specific configuration is turned on and off with its plugin, so
// its edits have no `enabled`.
export const McpAppConfigUpdateSchema = z.object({
  serverId: z.number().int().positive(),
  appConfigId: z.number().int().positive(),
  ...McpConnectionConfigUpdateFields,
  // Same limit as on create.
  name: z.string().max(100).optional(),
});

export type McpAppConfigUpdate = z.infer<typeof McpAppConfigUpdateSchema>;

export const McpConsentEnum = z.enum(["ask", "always", "denied"]);
export type McpConsentValue = z.infer<typeof McpConsentEnum>;

export const McpToolSchema = z.object({
  name: z.string(),
  description: z.string().nullable().optional(),
  consent: McpConsentEnum.optional(),
});

export type McpTool = z.infer<typeof McpToolSchema>;

// Result of a tools-listing attempt. `status` reports the outcome of
// the live connection so the UI can flag a server that needs auth
// without a separate probe.
export const McpListToolsResultSchema = z.object({
  tools: z.array(McpToolSchema),
  status: z.enum(["ok", "unauthorized", "error"]),
  errorMessage: z.string().max(2_000).optional(),
});

export type McpListToolsResult = z.infer<typeof McpListToolsResultSchema>;

export const McpToolConsentRecordSchema = z.object({
  id: z.number(),
  serverId: z.number(),
  appConfigId: z.number().nullable(),
  toolName: z.string(),
  consent: McpConsentEnum,
  updatedAt: z.date(),
});

export type McpToolConsent = z.infer<typeof McpToolConsentRecordSchema>;

export const SetMcpToolConsentParamsSchema = z.object({
  connection: McpConnectionRefSchema,
  toolName: z.string(),
  consent: McpConsentEnum,
});

export type SetMcpToolConsentParams = z.infer<
  typeof SetMcpToolConsentParamsSchema
>;

// =============================================================================
// MCP Contracts
// =============================================================================

export const mcpContracts = {
  listServers: defineContract({
    channel: "mcp:list-servers",
    input: z.void(),
    output: z.array(McpServerSchema),
  }),

  listCatalog: defineContract({
    channel: "mcp:list-catalog",
    input: z.void(),
    output: z.object({
      entries: z.array(McpCatalogEntrySchema),
      // Slugs that already have a configured server row.
      addedSlugs: z.array(z.string()),
    }),
  }),

  addFromCatalog: defineContract({
    channel: "mcp:add-from-catalog",
    // expectedStdioConfig is the command the consent prompt showed. The
    // handler aborts if the catalog it re-fetches no longer matches, so a
    // stale dialog can't add something the user didn't review.
    input: z.object({
      slug: z.string().min(1),
      expectedStdioConfig: z
        .object({
          command: z.string(),
          args: z.array(z.string()),
          env: z.record(z.string(), z.string()).nullable().optional(),
        })
        .optional(),
    }),
    output: McpServerSchema,
    invalidates: () => [
      { family: "mcp-servers" },
      { family: "mcp-catalog" },
      { family: "mcp-tools" },
    ],
    originHandles: () => [
      { family: "mcp-servers" },
      { family: "mcp-catalog" },
      { family: "mcp-tools" },
    ],
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
    invalidates: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
    originHandles: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
  }),

  deleteServer: defineContract({
    channel: "mcp:delete-server",
    input: z.number().int().positive(), // serverId
    output: z.object({ success: z.boolean() }),
    invalidates: () => [
      { family: "mcp-servers" },
      { family: "mcp-tools" },
      { family: "mcp-catalog" },
    ],
    originHandles: () => [
      { family: "mcp-servers" },
      { family: "mcp-tools" },
      { family: "mcp-catalog" },
    ],
  }),

  listTools: defineContract({
    channel: "mcp:list-tools",
    input: McpConnectionRefSchema,
    output: McpListToolsResultSchema,
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

  startOAuth: defineContract({
    channel: "mcp:start-oauth",
    input: z.object({
      connection: McpConnectionRefSchema,
      // Durable retry identity from the renderer. This is intentionally
      // distinct from the main-minted McpOAuthInvocationRef.
      rendererMessageId: z.string().min(1),
      // Optional per-flow override; lets the renderer pass a freshly
      // probed port for rows whose stored `oauthCallbackPort` is null
      // (e.g. created with OAuth off and then enabled via retry).
      callbackPort: z.number().int().min(1024).max(65535).optional(),
    }),
    output: z.object({
      success: z.boolean(),
      // Set when `success` is false; shown to the user as a toast on
      // the Plugins page.
      error: z.string().nullable(),
      errorKind: z.enum(["discovery_failed", "other"]).nullable().optional(),
    }),
  }),

  disconnectOAuth: defineContract({
    channel: "mcp:disconnect-oauth",
    input: McpConnectionRefSchema,
    output: z.object({ success: z.boolean() }),
    invalidates: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
    originHandles: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
  }),

  // App-scoped plugins experiment. The mutations below are refused while
  // the experiment is off.
  listAppConfigs: defineContract({
    channel: "mcp:list-app-configs",
    input: z.void(),
    output: z.array(McpAppConfigSchema),
  }),

  createAppConfig: defineContract({
    channel: "mcp:create-app-config",
    input: z.object({
      serverId: z.number().int().positive(),
      name: z.string().trim().min(1).max(100),
      // Apps already using another configuration of the plugin move to
      // this one.
      appIds: z.array(z.number().int().positive()).max(10_000),
    }),
    output: McpAppConfigSchema,
    invalidates: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
    originHandles: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
  }),

  updateAppConfig: defineContract({
    channel: "mcp:update-app-config",
    input: McpAppConfigUpdateSchema,
    output: McpAppConfigSchema,
    invalidates: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
    originHandles: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
  }),

  deleteAppConfig: defineContract({
    channel: "mcp:delete-app-config",
    input: z.object({
      serverId: z.number().int().positive(),
      appConfigId: z.number().int().positive(),
    }),
    output: z.object({ success: z.boolean() }),
    invalidates: () => [
      { family: "mcp-servers" },
      { family: "mcp-tools" },
      { family: "mcp-catalog" },
    ],
    originHandles: () => [
      { family: "mcp-servers" },
      { family: "mcp-tools" },
      { family: "mcp-catalog" },
    ],
  }),

  setAppConfigApps: defineContract({
    channel: "mcp:set-app-config-apps",
    input: z.object({
      serverId: z.number().int().positive(),
      appConfigId: z.number().int().positive(),
      appIds: z.array(z.number().int().positive()).max(10_000),
    }),
    output: McpAppConfigSchema,
    invalidates: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
    originHandles: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
  }),

  setPluginAvailability: defineContract({
    channel: "mcp:set-plugin-availability",
    input: z.object({
      serverId: z.number().int().positive(),
      defaultScope: PluginDefaultScopeSchema,
      // The apps a "selected" default serves; ignored otherwise.
      defaultAppIds: z.array(z.number().int().positive()).max(10_000),
    }),
    output: McpServerSchema,
    invalidates: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
    originHandles: () => [{ family: "mcp-servers" }, { family: "mcp-tools" }],
  }),

  probeCallbackPort: defineContract({
    channel: "mcp:probe-callback-port",
    input: z.void(),
    output: z.object({ port: z.number().int() }),
  }),

  probeConnection: defineContract({
    channel: "mcp:probe-connection",
    input: McpConnectionRefSchema,
    output: z.object({
      status: z.enum(["ok", "unauthorized", "error"]),
      error: z.string().nullable(),
    }),
  }),

  // Drives the no-keyring banner on the MCP settings page.
  isOauthStorageEncrypted: defineContract({
    channel: "mcp:is-oauth-storage-encrypted",
    input: z.void(),
    output: z.object({ available: z.boolean() }),
  }),
} as const;

// =============================================================================
// MCP Clients
// =============================================================================

export const mcpClient = createClient(mcpContracts);
