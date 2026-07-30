import { z } from "zod";
import {
  OperationRegistry,
  type OperationDisposalCause,
} from "@/distributed_machines/operation_registry";
import type { CorrelatedOperationOutcome } from "@/distributed_machines/operation_registry";
import { DyadErrorKind } from "@/errors/dyad_error";
import type {
  VersionPreviewIntentEvent,
  VersionPreviewInvocationRef,
} from "./transport";

export type VersionPreviewOperationKind =
  | "close"
  | "switch-app"
  | "select-version"
  | "switch-branch"
  | "restore"
  | "restore-to-message"
  | "retry-return";

export type VersionPreviewCancellationReason =
  | "superseded"
  | "actor-disposed"
  | "app-disposed"
  | "machine-disposed"
  | "host-disposed"
  | "window-disposed";

export type VersionPreviewOperationOutcome =
  | {
      readonly kind: "succeeded";
      readonly operation: VersionPreviewOperationKind;
      readonly cleanupStarted?: boolean;
    }
  | {
      readonly kind: "failed";
      readonly operation: VersionPreviewOperationKind;
      readonly error: {
        readonly message: string;
        readonly kind?: DyadErrorKind;
      };
    }
  | {
      readonly kind: "cancelled";
      readonly reason: VersionPreviewCancellationReason;
    };

export type VersionPreviewCorrelatedOutcome = CorrelatedOperationOutcome<
  VersionPreviewOperationOutcome,
  VersionPreviewInvocationRef
>;

export function versionPreviewOperationKind(
  event: Pick<VersionPreviewIntentEvent, "type">,
): VersionPreviewOperationKind {
  switch (event.type) {
    case "CLOSE":
      return "close";
    case "APP_CHANGED":
      return "switch-app";
    case "SELECT_VERSION":
      return "select-version";
    case "SWITCH_BRANCH":
      return "switch-branch";
    case "RESTORE":
      return "restore";
    case "RESTORE_TO_MESSAGE":
      return "restore-to-message";
    case "RETRY_RETURN":
      return "retry-return";
    case "ACQUIRE_WINDOW_INTEREST":
    case "RESTORE_WINDOW_INTEREST":
    case "RELEASE_WINDOW_INTEREST":
      throw new Error(`${event.type} does not create a version operation`);
  }
}

export class VersionPreviewEnqueueError extends Error {
  readonly name = "VersionPreviewEnqueueError";

  constructor(
    readonly operation: VersionPreviewOperationKind,
    readonly originalError: unknown,
  ) {
    super(
      originalError instanceof Error
        ? originalError.message
        : String(originalError),
      { cause: originalError },
    );
  }
}

const versionPreviewFailureSchema = z.preprocess(
  (value) => (value instanceof Error ? undefined : value),
  z
    .object({
      message: z.string(),
      kind: z.enum(DyadErrorKind).optional(),
    })
    .strict(),
);

export const VersionPreviewOperationOutcomeSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("succeeded"),
        operation: z.enum([
          "close",
          "switch-app",
          "select-version",
          "switch-branch",
          "restore",
          "restore-to-message",
          "retry-return",
        ]),
        cleanupStarted: z.boolean().optional(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("failed"),
        operation: z.enum([
          "close",
          "switch-app",
          "select-version",
          "switch-branch",
          "restore",
          "restore-to-message",
          "retry-return",
        ]),
        error: versionPreviewFailureSchema,
      })
      .strict(),
    z
      .object({
        kind: z.literal("cancelled"),
        reason: z.enum([
          "superseded",
          "actor-disposed",
          "app-disposed",
          "machine-disposed",
          "host-disposed",
          "window-disposed",
        ]),
      })
      .strict(),
  ],
);

function disposalReason(
  cause: OperationDisposalCause,
): VersionPreviewCancellationReason {
  switch (cause) {
    case "actor":
      return "actor-disposed";
    case "key":
      return "app-disposed";
    case "machine":
      return "machine-disposed";
    case "host":
      return "host-disposed";
    case "window-session":
      return "window-disposed";
  }
}

export const versionPreviewOperationRegistry = new OperationRegistry<
  VersionPreviewOperationOutcome,
  VersionPreviewInvocationRef
>({
  maxUnresolved: 256,
  maxSettledReplay: 128,
  now: Date.now,
  disposalOutcome: (cause) => ({
    kind: "cancelled",
    reason: disposalReason(cause),
  }),
  supersededOutcome: () => ({
    kind: "cancelled",
    reason: "superseded",
  }),
  enqueueFailureOutcome: (error) => {
    if (!(error instanceof VersionPreviewEnqueueError)) {
      throw new Error(
        "Version preview enqueue failure is missing operation context",
        { cause: error },
      );
    }
    return {
      kind: "failed",
      operation: error.operation,
      error: {
        message:
          error.originalError instanceof Error
            ? error.originalError.message
            : String(error.originalError),
      },
    };
  },
});
