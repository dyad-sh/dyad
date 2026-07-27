import { z } from "zod";
import { DyadErrorKind } from "@/errors/dyad_error";
import type { InvocationRef } from "@/state_machines/invocation_ref";
import type {
  GithubOperation,
  GithubOperationFailure,
  GithubOpsEvent,
  GithubOpsState,
} from "./state";

export const GITHUB_OPS_MACHINE_ID = "github_ops";
export const GITHUB_OPS_INVOCATION_KIND = "github-operation";

const operationIdSchema = z.string().min(1);
const repositoryRelativePathSchema = z
  .string()
  .refine(
    (value) =>
      value.length > 0 &&
      !value.startsWith("/") &&
      !value.startsWith("\\\\") &&
      !/^[a-zA-Z]:[\\/]/.test(value) &&
      !value.split(/[\\/]/).includes(".."),
    "Conflict names must be repository-relative paths",
  );

const githubOpsKeys = new Map<number, { appId: number }>();

export function githubOpsKey(appId: number): { appId: number } {
  let key = githubOpsKeys.get(appId);
  if (!key) {
    key = Object.freeze({ appId });
    githubOpsKeys.set(appId, key);
  }
  return key;
}

export const GithubOpsKeySchema = z
  .object({ appId: z.number().int().nonnegative() })
  .strict()
  .transform(({ appId }) => Object.freeze({ appId }));
export type GithubOpsKey = z.infer<typeof GithubOpsKeySchema>;

export type GithubOpsInvocationRef = InvocationRef<
  typeof GITHUB_OPS_INVOCATION_KIND,
  number
>;

export const GithubOpsInvocationRefSchema = z
  .object({
    kind: z.literal(GITHUB_OPS_INVOCATION_KIND),
    entityKey: z.number().int().positive(),
    operationId: operationIdSchema,
  })
  .strict();

const pushOperationSchema = z
  .object({
    type: z.literal("push"),
    mode: z.enum(["normal", "force", "lease"]),
  })
  .strict();
const connectRepositoryOperationSchema = z.discriminatedUnion("mode", [
  z
    .object({
      type: z.literal("connect-repo"),
      mode: z.literal("create"),
      org: z.string(),
      repo: z.string(),
      branch: z.string().optional(),
      thenAutoPush: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("connect-repo"),
      mode: z.literal("existing"),
      owner: z.string(),
      repo: z.string(),
      branch: z.string(),
      thenAutoPush: z.boolean(),
    })
    .strict(),
]);
export const GithubOperationSchema: z.ZodType<GithubOperation> =
  z.discriminatedUnion("type", [
    pushOperationSchema,
    z.object({ type: z.literal("pull") }).strict(),
    z.object({ type: z.literal("fetch") }).strict(),
    z.object({ type: z.literal("rebase") }).strict(),
    z.object({ type: z.literal("rebase-continue") }).strict(),
    z.object({ type: z.literal("rebase-abort") }).strict(),
    z.object({ type: z.literal("merge-abort") }).strict(),
    z.object({ type: z.literal("merge"), branch: z.string() }).strict(),
    z.object({ type: z.literal("switch"), branch: z.string() }).strict(),
    z
      .object({
        type: z.literal("create-branch"),
        name: z.string(),
        from: z.string().optional(),
        thenSwitch: z.boolean(),
      })
      .strict(),
    z.object({ type: z.literal("delete-branch"), branch: z.string() }).strict(),
    z
      .object({
        type: z.literal("rename-branch"),
        oldBranch: z.string(),
        newBranch: z.string(),
      })
      .strict(),
    z.object({ type: z.literal("disconnect") }).strict(),
    connectRepositoryOperationSchema,
  ]);

// Zod cannot select a discriminated-union property schema portably, so keep
// the operation-name allowlist explicit at the wire boundary.
const operationTypeSchema = z.enum([
  "push",
  "pull",
  "fetch",
  "rebase",
  "rebase-continue",
  "rebase-abort",
  "merge-abort",
  "merge",
  "switch",
  "create-branch",
  "delete-branch",
  "rename-branch",
  "disconnect",
  "connect-repo",
]);

const githubOpsBannerSchema = z
  .object({
    kind: z.enum(["success", "error", "info"]),
    code: z.string().optional(),
    completedOperation: operationTypeSchema.optional(),
    message: z.string(),
  })
  .strict();

const conflictOriginSchema = z.union([
  GithubOperationSchema,
  z.object({ type: z.literal("reconcile") }).strict(),
]);
const blockedSwitchResumeSchema = z.union([
  z
    .object({
      type: z.literal("conflicted"),
      files: z.array(repositoryRelativePathSchema),
      origin: conflictOriginSchema,
    })
    .strict(),
  z.object({ type: z.literal("rebase-paused") }).strict(),
]);

export const GithubOpsStateSchema: z.ZodType<GithubOpsState> =
  z.discriminatedUnion("type", [
    z
      .object({
        type: z.literal("idle"),
        banner: githubOpsBannerSchema.nullable(),
      })
      .strict(),
    z
      .object({
        type: z.literal("running"),
        op: GithubOperationSchema,
        next: GithubOperationSchema.optional(),
        awaitingConflicts: z.boolean().optional(),
        blockedSwitchResume: blockedSwitchResumeSchema.optional(),
        banner: githubOpsBannerSchema.nullable(),
      })
      .strict(),
    z
      .object({
        type: z.literal("conflicted"),
        files: z.array(repositoryRelativePathSchema),
        origin: conflictOriginSchema,
        banner: githubOpsBannerSchema.nullable(),
      })
      .strict(),
    z
      .object({
        type: z.literal("rebase-paused"),
        banner: githubOpsBannerSchema.nullable(),
      })
      .strict(),
    z
      .object({
        type: z.literal("switch-blocked"),
        target: z.string(),
        blockingOp: z.enum(["merge", "rebase"]),
        hasConflicts: z.boolean(),
        resume: blockedSwitchResumeSchema.optional(),
        banner: githubOpsBannerSchema.nullable(),
      })
      .strict(),
  ]);

const operationRequestedSchema = z
  .object({
    type: z.literal("OP_REQUESTED"),
    op: GithubOperationSchema,
    operationId: operationIdSchema,
    activeInvocationRef: GithubOpsInvocationRefSchema.optional(),
  })
  .strict();

export const GithubOpsIntentEventSchema = z.union([
  operationRequestedSchema,
  z
    .object({
      type: z.literal("ABORT_AND_SWITCH_CONFIRMED"),
      operationId: operationIdSchema,
    })
    .strict(),
  z.object({ type: z.literal("BLOCKED_DISMISSED") }).strict(),
  z.object({ type: z.literal("RESOLVE_WITH_AI_STARTED") }).strict(),
  z.object({ type: z.literal("BANNER_DISMISSED") }).strict(),
  z.object({ type: z.literal("RECONCILE_REQUESTED") }).strict(),
  z.object({ type: z.literal("CONFLICT_RESOLUTION_STARTED") }).strict(),
  z.object({ type: z.literal("CONFLICT_RESOLUTION_CANCELLED") }).strict(),
]);
export type GithubOpsIntentEvent = z.infer<typeof GithubOpsIntentEventSchema>;

const operationFailureSchema: z.ZodType<GithubOperationFailure> = z
  .object({
    code: z.string().optional(),
    kind: z.string(),
    message: z.string(),
  })
  .strict();

export const GithubOpsProducerEventSchema = z.union([
  z
    .object({
      type: z.literal("OP_SUCCEEDED"),
      op: GithubOperationSchema,
      invocationRef: GithubOpsInvocationRefSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("OP_FAILED"),
      op: GithubOperationSchema,
      failure: operationFailureSchema,
      invocationRef: GithubOpsInvocationRefSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("CONFLICTS"),
      files: z.array(repositoryRelativePathSchema),
      recoveryInvocationRef: GithubOpsInvocationRefSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("GIT_STATE"),
      mergeInProgress: z.boolean(),
      rebaseInProgress: z.boolean(),
      recoveryInvocationRef: GithubOpsInvocationRefSchema.optional(),
    })
    .strict(),
]);
export type GithubOpsProducerEvent = z.infer<
  typeof GithubOpsProducerEventSchema
>;
export type GithubOpsWireEvent = GithubOpsIntentEvent | GithubOpsProducerEvent;

export interface GithubOpsActorState {
  readonly state: GithubOpsState;
  readonly activeInvocationRef: GithubOpsInvocationRef | null;
  readonly conflictResolutionPending: boolean;
}

export const GithubOpsRemoteSnapshotSchema = z
  .object({
    appId: z.number().int().nonnegative(),
    revision: z.number().int().nonnegative(),
    state: GithubOpsStateSchema,
    activeInvocationRef: GithubOpsInvocationRefSchema.nullable(),
  })
  .strict();
export type GithubOpsRemoteSnapshot = z.infer<
  typeof GithubOpsRemoteSnapshotSchema
>;

export function projectGithubOpsRemoteSnapshot(
  appId: number,
  revision: number,
  actorState: GithubOpsActorState,
): GithubOpsRemoteSnapshot {
  if (
    actorState.activeInvocationRef &&
    actorState.activeInvocationRef.entityKey !== appId
  ) {
    throw new Error("GitHub operation invocation does not match its actor key");
  }
  return {
    appId,
    revision,
    state: actorState.state,
    activeInvocationRef: actorState.activeInvocationRef,
  };
}

export function isGithubOpsStateSensitiveIntent(
  event: GithubOpsIntentEvent,
): boolean {
  switch (event.type) {
    case "OP_REQUESTED":
      return event.op.type !== "fetch";
    case "ABORT_AND_SWITCH_CONFIRMED":
    case "BLOCKED_DISMISSED":
    case "RESOLVE_WITH_AI_STARTED":
    case "CONFLICT_RESOLUTION_STARTED":
    case "CONFLICT_RESOLUTION_CANCELLED":
      return true;
    case "BANNER_DISMISSED":
    case "RECONCILE_REQUESTED":
      return false;
  }
}

export function toGithubOpsDomainEvent(
  event: GithubOpsWireEvent,
): GithubOpsEvent {
  switch (event.type) {
    case "OP_REQUESTED":
      return { type: "OP_REQUESTED", op: event.op };
    case "OP_SUCCEEDED":
      return { type: "OP_SUCCEEDED", op: event.op };
    case "OP_FAILED":
      return { type: "OP_FAILED", op: event.op, failure: event.failure };
    case "CONFLICTS":
      return event;
    case "GIT_STATE":
      return event;
    case "CONFLICT_RESOLUTION_STARTED":
      return { type: "CONFLICTS", files: [] };
    case "CONFLICT_RESOLUTION_CANCELLED":
      return { type: "RECONCILE_REQUESTED" };
    case "ABORT_AND_SWITCH_CONFIRMED":
    case "BLOCKED_DISMISSED":
    case "RESOLVE_WITH_AI_STARTED":
    case "BANNER_DISMISSED":
    case "RECONCILE_REQUESTED":
      return { type: event.type };
  }
}

export function githubOpsFailureKind(error: unknown): string {
  return error instanceof Error && "kind" in error
    ? String((error as Error & { kind: unknown }).kind)
    : DyadErrorKind.External;
}
