import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";

// =============================================================================
// Coolify Schemas
// =============================================================================

export const CoolifyServerSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  // Coolify reaches its servers over SSH, so it already knows how to address
  // them. Reusing that keeps Dyad's tunnel pointed at the same machine the
  // database is provisioned on.
  ip: z.string().nullable().optional(),
  user: z.string().nullable().optional(),
  port: z.number().nullable().optional(),
});

export type CoolifyServer = z.infer<typeof CoolifyServerSchema>;

export const CoolifyProjectSchema = z.object({
  uuid: z.string(),
  name: z.string(),
});

export type CoolifyProject = z.infer<typeof CoolifyProjectSchema>;

export const CoolifyConnectionSchema = z.object({
  instanceUrl: z.string().url(),
  serverUuid: z.string().min(1),
  projectUuid: z.string().min(1),
  environmentName: z.string().min(1).default("production"),
  // SSH details for the tunnel used to reach a provisioned database. Coolify's
  // API token cannot open one, so this is a separate credential path.
  sshHost: z.string().min(1),
  sshUser: z.string().min(1).default("root"),
  sshPort: z.number().int().min(1).max(65535).default(22),
});

export type CoolifyConnection = z.infer<typeof CoolifyConnectionSchema>;

export const CoolifyStatusSchema = z.object({
  hasToken: z.boolean(),
  sshAvailable: z.boolean(),
  sshKeyExists: z.boolean(),
  sshPublicKey: z.string().nullable(),
  connection: CoolifyConnectionSchema.nullable(),
  appUuid: z.string().nullable(),
  databaseUuid: z.string().nullable(),
  appUrl: z.string().nullable(),
});

export type CoolifyStatus = z.infer<typeof CoolifyStatusSchema>;

export const CoolifyDeployStageSchema = z.enum([
  "preflight",
  "push",
  "provision-database",
  "migrate",
  "create-application",
  "deploy",
  "finalize",
]);

export type CoolifyDeployStage = z.infer<typeof CoolifyDeployStageSchema>;

export const CoolifyDeploySnapshotSchema = z.object({
  status: z.enum(["idle", "running", "succeeded", "failed"]),
  stage: CoolifyDeployStageSchema.nullable(),
  error: z.string().nullable(),
  log: z.string(),
  url: z.string().nullable(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
});

export type CoolifyDeploySnapshot = z.infer<typeof CoolifyDeploySnapshotSchema>;

export const CoolifyInstallSnapshotSchema = z.object({
  status: z.enum(["idle", "running", "succeeded", "failed"]),
  log: z.string(),
  error: z.string().nullable(),
  dashboardUrl: z.string().nullable(),
  // Shown once so the user can sign in; also kept in settings.
  credentials: z
    .object({
      username: z.string(),
      email: z.string(),
      password: z.string(),
    })
    .nullable(),
});

export type CoolifyInstallSnapshot = z.infer<
  typeof CoolifyInstallSnapshotSchema
>;

export const InstallCoolifyParamsSchema = z.object({
  adminEmail: z.string().email(),
  sshHost: z.string().min(1),
  sshUser: z.string().min(1).default("root"),
  sshPort: z.number().int().min(1).max(65535).default(22),
});

export const CoolifyAppParamsSchema = z.object({ appId: z.number() });

export const SaveCoolifyTokenParamsSchema = z.object({
  instanceUrl: z.string().url(),
  token: z.string().min(1),
});

export const CoolifyDiscoverySchema = z.object({
  servers: z.array(CoolifyServerSchema),
  projects: z.array(CoolifyProjectSchema),
});

export type CoolifyDiscovery = z.infer<typeof CoolifyDiscoverySchema>;

// Saving only persists where to deploy and how to reach it. The instance URL
// lives in settings, so requiring it here made the call fail whenever the
// renderer had not just been through the token form.
export const SaveCoolifyConnectionParamsSchema = z.object({
  appId: z.number(),
  connection: CoolifyConnectionSchema.omit({ instanceUrl: true }),
});

export const DeployToCoolifyParamsSchema = z.object({
  appId: z.number(),
});

// =============================================================================
// Coolify Contracts
// =============================================================================

export const coolifyContracts = {
  getStatus: defineContract({
    channel: "coolify:get-status",
    input: CoolifyAppParamsSchema,
    output: CoolifyStatusSchema,
  }),

  // DO NOT LOG: carries an API token.
  saveToken: defineContract({
    channel: "coolify:save-token",
    input: SaveCoolifyTokenParamsSchema,
    output: z.void(),
  }),

  discover: defineContract({
    channel: "coolify:discover",
    input: z.void(),
    output: CoolifyDiscoverySchema,
  }),

  generateSshKey: defineContract({
    channel: "coolify:generate-ssh-key",
    input: z.void(),
    output: z.object({ publicKey: z.string() }),
  }),

  install: defineContract({
    channel: "coolify:install",
    input: InstallCoolifyParamsSchema,
    output: z.void(),
  }),

  getInstallSnapshot: defineContract({
    channel: "coolify:get-install-snapshot",
    input: z.void(),
    output: CoolifyInstallSnapshotSchema,
  }),

  regenerateSshKey: defineContract({
    channel: "coolify:regenerate-ssh-key",
    input: z.void(),
    output: z.object({ publicKey: z.string() }),
  }),

  testSsh: defineContract({
    channel: "coolify:test-ssh",
    input: z.object({
      sshHost: z.string(),
      sshUser: z.string(),
      sshPort: z.number(),
    }),
    output: z.object({ ok: z.boolean(), error: z.string().optional() }),
  }),

  saveConnection: defineContract({
    channel: "coolify:save-connection",
    input: SaveCoolifyConnectionParamsSchema,
    output: z.void(),
  }),

  deploy: defineContract({
    channel: "coolify:deploy",
    input: DeployToCoolifyParamsSchema,
    output: z.void(),
  }),

  getDeploySnapshot: defineContract({
    channel: "coolify:get-deploy-snapshot",
    input: CoolifyAppParamsSchema,
    output: CoolifyDeploySnapshotSchema,
  }),

  clearToken: defineContract({
    channel: "coolify:clear-token",
    input: z.void(),
    output: z.void(),
  }),

  createProject: defineContract({
    channel: "coolify:create-project",
    input: z.object({ name: z.string().min(1) }),
    output: CoolifyProjectSchema,
  }),

  setPortableCodegen: defineContract({
    channel: "coolify:set-portable-codegen",
    input: z.object({ appId: z.number(), enabled: z.boolean() }),
    output: z.void(),
  }),

  disconnect: defineContract({
    channel: "coolify:disconnect",
    input: CoolifyAppParamsSchema,
    output: z.void(),
  }),
} as const;

// =============================================================================
// Coolify Events
// =============================================================================

export const coolifyEvents = {
  installStatus: defineEvent({
    channel: "coolify:install-status",
    payload: z.object({ snapshot: CoolifyInstallSnapshotSchema }),
  }),

  deployStatus: defineEvent({
    channel: "coolify:deploy-status",
    payload: z.object({
      appId: z.number(),
      snapshot: CoolifyDeploySnapshotSchema,
    }),
  }),
} as const;

// =============================================================================
// Coolify Client
// =============================================================================

export const coolifyClient = createClient(coolifyContracts);
export const coolifyEventClient = createEventClient(coolifyEvents);
