import { z } from "zod";
import type { CoolifySetupState } from "@/coolify_setup/state";
import {
  defineContract,
  defineEvent,
  createClient,
  createEventClient,
} from "../contracts/core";

// =============================================================================
// Coolify Setup Schemas
// =============================================================================

export const SetupStepSchema = z.enum([
  "connecting",
  "checking-server",
  "installing",
  "waiting-for-dashboard",
  "verifying-account",
  "securing",
  "creating-token",
  "done",
]);

export const ServerKeySchema = z.object({
  /** The line the user adds to their server's authorized_keys. */
  publicKey: z.string(),
});

/**
 * Marks a failure the machine took on and has already put on screen.
 *
 * The panel shows anything it cannot attribute, because an error nobody
 * reports is a button that does nothing. So the mark goes on the case that
 * IS accounted for — a run that failed or was cancelled, which the finished
 * screen carries with the installer's own words — and everything else,
 * including whatever the IPC layer refuses before this handler is reached,
 * is said out loud.
 */
export const SETUP_MACHINE_REPORTED = "coolify-setup-machine-reported";

/**
 * Where the server is. Everything needed to reach it, and nothing else.
 *
 * Separate from the address of the account to create, because looking at a
 * server does not need one — demanding it there rejected a check the panel
 * was offering before the email had been typed.
 */
export const SetupServerSchema = z.object({
  host: z.string().min(1),
  /** Coolify's installer needs root, and says so in its own documentation. */
  username: z.string().min(1).default("root"),
  port: z.number().int().positive().max(65535).optional(),
});

export const SetupTargetSchema = SetupServerSchema.extend({
  adminEmail: z.string().min(3),
  /**
   * A domain the user owns, pointed at this server.
   *
   * Optional because Dyad can derive one from the address. Supplying one is
   * better where they have it: it is theirs, and it does not draw on the free
   * shared service's certificate allowance.
   */
  customDomain: z.string().optional(),
});

/**
 * What Dyad found when it looked at the server, before touching it.
 *
 * Reported rather than acted on, so the panel can explain the two problems a
 * user can fix immediately instead of failing several minutes into an install.
 */
export const SetupPreflightSchema = z.object({
  ready: z.boolean(),
  reason: z.string().nullable(),
  alreadyInstalled: z.boolean(),
  memoryMb: z.number().nullable(),
  /** Shown so the user can compare it against their provider's console. */
  hostFingerprint: z.string().nullable(),
});

export const SetupResultSchema = z.object({
  dashboardUrl: z.string(),
  /**
   * Whether that address is encrypted.
   *
   * Dyad asks for a certificate and settles for plain HTTP when none arrives,
   * so this is the outcome rather than a setting — and the token it carries has
   * root abilities and travels on every deploy.
   */
  secure: z.boolean(),
  insecureReason: z.string().nullable(),
  adminEmail: z.string(),
  /**
   * Returned so the fallback screen can show it when no token was created.
   *
   * On the ordinary path it is stored instead, and read back through
   * revealCredentials — a password shown once is a password nobody can use.
   */
  adminPassword: z.string(),
  /** Null when Coolify was installed but its API could not be opened. */
  tokenStored: z.boolean(),
  tokenUnavailableReason: z.string().nullable(),
  version: z.string().nullable(),
});

/**
 * What Dyad can tell the user about getting into their own server.
 *
 * Two records, each carrying its own address, because they are facts about
 * two different things: the instance Dyad talks to, and a machine Dyad built.
 * Usually the same server, but not always — an install whose token could not
 * be minted leaves an account behind while the user connects somewhere else.
 * Folded into one address they would have to be checked against each other
 * before either could be shown, and a check that guessed wrong would put one
 * server's password under another's address.
 *
 * Null where Dyad never had it: an instance connected by pasting a token has
 * no admin account Dyad created, and a server set up but not connected to has
 * no instance.
 */
export const RevealedCredentialsSchema = z.object({
  instance: z
    .object({
      url: z.string(),
      apiToken: z.string().nullable(),
    })
    .nullable(),
  server: z
    .object({
      url: z.string(),
      email: z.string(),
      password: z.string().nullable(),
    })
    .nullable(),
});

/**
 * What the main process is doing with a server, as the panel sees it.
 *
 * The panel keeps none of this: an install outlives the screen that started
 * it, so the screen asks rather than remembers. Mirrors CoolifySetupState,
 * with an assertion beside that type so neither can drift from the other.
 */
export const SetupInvocationRefSchema = z.object({
  kind: z.literal("coolify-setup"),
  entityKey: z.string(),
  operationId: z.string(),
});

export const SetupSnapshotSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("idle") }),
  z.object({
    type: z.literal("running"),
    host: z.string(),
    invocationRef: SetupInvocationRefSchema,
    step: SetupStepSchema,
    log: z.string(),
    stopping: z.boolean(),
  }),
  z.object({
    type: z.literal("done"),
    host: z.string(),
    invocationRef: SetupInvocationRefSchema,
    result: SetupResultSchema,
  }),
  z.object({
    type: z.literal("failed"),
    host: z.string(),
    invocationRef: SetupInvocationRefSchema,
    message: z.string(),
    log: z.string(),
    cancelled: z.boolean(),
  }),
]);

// =============================================================================
// Coolify Setup Contracts
// =============================================================================

export const coolifySetupContracts = {
  /**
   * The public key the user has to install before anything else can happen.
   *
   * First, because it is the one manual step and nothing works until it is
   * done. Generated on demand and reused afterwards.
   */
  getServerKey: defineContract({
    channel: "coolify-setup:get-server-key",
    input: z.void(),
    output: ServerKeySchema,
  }),

  /**
   * Connects and looks, without changing anything.
   *
   * Separate from running the setup so the panel can show what it found — the
   * host fingerprint especially — and let the user decide before a minutes-long
   * install starts.
   */
  inspect: defineContract({
    channel: "coolify-setup:inspect",
    input: SetupServerSchema,
    output: SetupPreflightSchema,
  }),

  // DO NOT LOG this handler: its result carries an admin password.
  run: defineContract({
    channel: "coolify-setup:run",
    input: SetupTargetSchema,
    output: SetupResultSchema,
    // A token stored here makes every app readable as connected, exactly as
    // saving one by hand does.
    invalidates: () => [{ family: "apps" }, { family: "coolify" }],
    // Claimed, because this panel refreshes coolify itself and chooses when:
    // an install that ended on plain HTTP has a warning to show first, and a
    // refresh here flips the panel to connected and unmounts the screen
    // carrying it. `apps` is not claimed — nothing repeats that locally.
    originHandles: () => [{ family: "coolify" }],
  }),

  /**
   * The credentials for a server Dyad set up, on request.
   *
   * A separate call rather than part of the status, so the panel can show
   * them long after the install that made them. The finished screen carries
   * its own copy in the snapshot while it is up; this is how they are read
   * once it is gone.
   */
  revealCredentials: defineContract({
    channel: "coolify-setup:reveal-credentials",
    input: z.void(),
    output: RevealedCredentialsSchema,
  }),

  /**
   * What is going on right now, asked on mount rather than remembered.
   *
   * DO NOT LOG this handler. A finished run carries the admin password Dyad
   * invented, the same secret `run` and `revealCredentials` are marked for —
   * and this hands back the identical payload, as does the `changed` event
   * that pushes it to every window.
   */
  snapshot: defineContract({
    channel: "coolify-setup:snapshot",
    input: z.void(),
    output: SetupSnapshotSchema,
  }),

  /**
   * The user read the unencrypted-address warning and accepted it.
   *
   * A token for an address that is not encrypted is held rather than stored
   * when the run ends, so that closing the screen, quitting, or a crash
   * leaves Dyad unconnected rather than connected to something nobody agreed
   * to. This is the only way it reaches disk. Nothing to decline: not
   * accepting is simply never calling it.
   */
  acceptInsecureToken: defineContract({
    channel: "coolify-setup:accept-insecure-token",
    input: z.void(),
    output: z.void(),
  }),

  /** The user has read the finished screen; put the panel back to the form. */
  dismiss: defineContract({
    channel: "coolify-setup:dismiss",
    input: z.void(),
    output: z.void(),
  }),

  cancel: defineContract({
    channel: "coolify-setup:cancel",
    input: z.void(),
    output: z.void(),
  }),
} as const;

export const coolifySetupEvents = {
  /**
   * The whole of what is going on, rather than a step at a time.
   *
   * Sending the state instead of a delta is what lets a window that was not
   * there for the earlier events still show the install correctly.
   */
  // DO NOT LOG. Carries the same finished-run payload as `snapshot`, admin
  // password and all, to every window.
  changed: defineEvent({
    channel: "coolify-setup:changed",
    payload: SetupSnapshotSchema,
  }),
} as const;

/**
 * The wire shape and the machine's state are the same thing.
 *
 * Asserted rather than assumed. The machine owns its types — a pure machine
 * module may not import from here — so this is where the two are held
 * together, and either drifting fails type-checking rather than failing in a
 * window that cannot parse what it was sent. Tupled, because a bare `extends`
 * distributes over the union and answers true when any one member fits.
 */
type AssignableTo<Source, Target> = [Source] extends [Target] ? true : never;
const _snapshotMatchesState: [
  AssignableTo<CoolifySetupState, SetupSnapshot>,
  AssignableTo<SetupSnapshot, CoolifySetupState>,
] = [true, true];
void _snapshotMatchesState;

export const coolifySetupClient = createClient(coolifySetupContracts);
export const coolifySetupEventClient = createEventClient(coolifySetupEvents);

export type SetupTarget = z.infer<typeof SetupTargetSchema>;
export type SetupServer = z.infer<typeof SetupServerSchema>;
export type SetupPreflight = z.infer<typeof SetupPreflightSchema>;
export type SetupResult = z.infer<typeof SetupResultSchema>;
export type SetupSnapshot = z.infer<typeof SetupSnapshotSchema>;
export type SetupStep = z.infer<typeof SetupStepSchema>;
export type RevealedCredentials = z.infer<typeof RevealedCredentialsSchema>;
