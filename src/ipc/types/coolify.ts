import { z } from "zod";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";
import type { CoolifyDeployState } from "@/coolify_deploy/state";

// =============================================================================
// Coolify Schemas
// =============================================================================

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Whether the API token would be encrypted in transit.
 *
 * A stock Coolify install serves plain HTTP until a domain and certificate are
 * configured, so http is allowed — but the user has to acknowledge it, since
 * the bearer token is then readable by anything on the network path. Loopback
 * never leaves the machine, so it counts as secure.
 */
export function isSecureInstanceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

export const CoolifyInstanceUrlSchema = z
  .string()
  .url()
  .refine(
    (value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === "https:" || protocol === "http:";
      } catch {
        return false;
      }
    },
    { message: "Enter an http:// or https:// address." },
  );

export const CoolifyServerSchema = z.object({
  uuid: z.string(),
  name: z.string(),
  ip: z.string().nullable().optional(),
  // Coolify builds a generated address from this, so its scheme decides
  // whether an app with no domain of its own is served over TLS. Optional:
  // an instance too old to send it leaves the question unanswered rather
  // than answering it wrongly.
  settings: z
    .object({ wildcard_domain: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

export type CoolifyServerInfo = z.infer<typeof CoolifyServerSchema>;

export const CoolifyProjectSchema = z.object({
  uuid: z.string(),
  name: z.string(),
});

export type CoolifyProjectInfo = z.infer<typeof CoolifyProjectSchema>;

export const CoolifyConnectionSchema = z.object({
  instanceUrl: z.string(),
  serverUuid: z.string().min(1),
  projectUuid: z.string().min(1),
  environmentName: z.string().min(1).default("production"),
  domain: z.string().nullable(),
});

export type CoolifyConnection = z.infer<typeof CoolifyConnectionSchema>;

export const CoolifyStatusSchema = z.object({
  hasToken: z.boolean(),
  /**
   * A stable, non-reversible name for whichever token is stored, or null.
   *
   * Servers and projects are cached per instance, and two tokens on the same
   * instance can see entirely different teams — so the cache has to be able to
   * tell that the token changed without ever being told what it is.
   */
  tokenId: z.string().nullable(),
  /** Remembered across a token clear, so re-entering a token does not retype it. */
  instanceUrl: z.string().nullable(),
  /**
   * The address of a server Dyad set up and holds an admin account for, or
   * null. Not a secret, and the panel needs it without the password: while
   * this is set the only Coolify Dyad will connect to is this one, so it
   * pins the address field and stands in the way of setting up another.
   */
  serverUrl: z.string().nullable(),
  connection: CoolifyConnectionSchema.nullable(),
  appUrl: z.string().nullable(),
  /** Epoch millis of the last successful deploy, or null if never deployed. */
  lastDeployedAt: z.number().nullable(),
});

export type CoolifyStatus = z.infer<typeof CoolifyStatusSchema>;

export const CoolifyDeployStageSchema = z.enum([
  "preparing",
  "configuring",
  "building",
]);

export type CoolifyDeployStage = z.infer<typeof CoolifyDeployStageSchema>;

/** Wire form of the deployment machine's state. */
export const CoolifyDeploySnapshotSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("idle") }),
  z.object({
    type: z.literal("running"),
    appId: z.number(),
    invocationRef: z.object({
      kind: z.literal("coolify-deploy"),
      entityKey: z.number(),
      operationId: z.string(),
    }),
    stage: CoolifyDeployStageSchema,
    log: z.string(),
    startedAt: z.number(),
    deploymentUuid: z.string().nullable(),
  }),
  z.object({
    type: z.literal("succeeded"),
    appId: z.number(),
    log: z.string(),
    url: z.string().nullable(),
    finishedAt: z.number(),
  }),
  z.object({
    type: z.literal("failed"),
    appId: z.number(),
    log: z.string(),
    error: z.string(),
    finishedAt: z.number(),
    deploymentUuid: z.string().nullable(),
  }),
]);

export type CoolifyDeploySnapshot = z.infer<typeof CoolifyDeploySnapshotSchema>;

// Fails type-checking if the machine's state and this wire schema drift apart.
const _wireMatchesState: CoolifyDeploySnapshot =
  null as never as CoolifyDeployState;
const _stateMatchesWire: CoolifyDeployState =
  null as never as CoolifyDeploySnapshot;
void _wireMatchesState;
void _stateMatchesWire;

export const CoolifyAppParamsSchema = z.object({ appId: z.number() });

export const SaveCoolifyTokenParamsSchema = z.object({
  instanceUrl: CoolifyInstanceUrlSchema,
  token: z.string().min(1),
  /** Required for an http address, so the risk is a choice rather than a default. */
  acknowledgedInsecure: z.boolean().default(false),
});

export const CoolifyDiscoverySchema = z.object({
  servers: z.array(CoolifyServerSchema),
  projects: z.array(CoolifyProjectSchema),
});

export type CoolifyDiscovery = z.infer<typeof CoolifyDiscoverySchema>;

// The instance URL lives in settings, so requiring it here would fail whenever
// the renderer had not just been through the token form.
export const SaveCoolifyConnectionParamsSchema = z.object({
  appId: z.number(),
  connection: CoolifyConnectionSchema.omit({ instanceUrl: true }),
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
    // Reaches every app: without a token none of them reads as connected.
    invalidates: () => [{ family: "apps" }, { family: "coolify" }],
    // The hook invalidates the coolify scope itself in onSuccess, so the
    // window that acted would otherwise do it twice — and invalidateQueries
    // cancels an in-flight refetch, making the second one a fresh round trip
    // to the user's server. Only coolify is claimed: `apps` is not repeated
    // locally, so suppressing it here would leave the acting window stale.
    originHandles: () => [{ family: "coolify" }],
  }),

  discover: defineContract({
    channel: "coolify:discover",
    input: z.void(),
    output: CoolifyDiscoverySchema,
  }),

  saveConnection: defineContract({
    channel: "coolify:save-connection",
    input: SaveCoolifyConnectionParamsSchema,
    output: z.void(),
    // The app row changed, so a second window showing this app would keep
    // offering controls for the server and domain it used to have. The coolify
    // scope is the one that reaches the status query; apps and app only reach
    // the list and the detail.
    invalidates: (input) => [
      { family: "apps" },
      { family: "app", appId: input.appId },
      { family: "coolify", appId: input.appId },
    ],
    // Claimed for the same reason as saveToken: the hook already refreshes
    // this app's status locally.
    originHandles: (input) => [{ family: "coolify", appId: input.appId }],
  }),

  checkDomain: defineContract({
    channel: "coolify:check-domain",
    // The server is passed in rather than read back from the app row, which is
    // not written until the connection is saved — and the check runs before.
    input: z.object({
      serverUuid: z.string().min(1),
      domain: z.string().min(1),
    }),
    // A verdict rather than a boolean, so "we could not check" is not
    // reported as "the domain is wrong".
    output: z.object({
      verdict: z.enum(["ok", "points-elsewhere", "no-records", "unknown"]),
      /** The hostname actually resolved, which is not always what was typed. */
      hostname: z.string().nullable(),
      expectedIp: z.string().nullable(),
      actualIps: z.array(z.string()),
    }),
  }),

  deploy: defineContract({
    channel: "coolify:deploy",
    input: CoolifyAppParamsSchema,
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
    // Every app reads as disconnected without a token.
    invalidates: () => [{ family: "apps" }, { family: "coolify" }],
    // The hook invalidates the coolify scope itself in onSuccess, so the
    // window that acted would otherwise do it twice — and invalidateQueries
    // cancels an in-flight refetch, making the second one a fresh round trip
    // to the user's server. Only coolify is claimed: `apps` is not repeated
    // locally, so suppressing it here would leave the acting window stale.
    originHandles: () => [{ family: "coolify" }],
  }),

  createProject: defineContract({
    channel: "coolify:create-project",
    input: z.object({ name: z.string().min(1) }),
    // Coolify's create response carries only a uuid, so echoing back the name
    // that was sent would hide any normalisation it applied. The refreshed
    // project list is the authority on what it is actually called.
    output: z.object({ uuid: z.string() }),
    // Otherwise a project made in one window never reaches another's picker,
    // and the user cannot select what they just created.
    invalidates: () => [{ family: "coolify" }],
    originHandles: () => [{ family: "coolify" }],
  }),

  disconnect: defineContract({
    channel: "coolify:disconnect",
    input: CoolifyAppParamsSchema,
    output: z.void(),
    invalidates: (input) => [
      { family: "apps" },
      { family: "app", appId: input.appId },
      { family: "coolify", appId: input.appId },
    ],
    // Claimed for the same reason as saveToken: the hook already refreshes
    // this app's status locally.
    originHandles: (input) => [{ family: "coolify", appId: input.appId }],
  }),
} as const;

// =============================================================================
// Coolify Events
// =============================================================================

export const coolifyEvents = {
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
