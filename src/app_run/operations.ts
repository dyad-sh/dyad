import {
  OperationRegistry,
  type OperationDisposalCause,
} from "@/distributed_machines/operation_registry";
import type { AppRunInvocationRef, RunErrorInfo } from "./state";

export type AppRunOperationKind = "run" | "stop";

export type AppRunOperationOutcome =
  | { readonly kind: "succeeded"; readonly operation: AppRunOperationKind }
  | {
      readonly kind: "failed";
      readonly operation: AppRunOperationKind;
      readonly error: RunErrorInfo;
    }
  | {
      readonly kind: "cancelled";
      readonly reason:
        | "superseded"
        | "actor-disposed"
        | "app-disposed"
        | "machine-disposed"
        | "host-disposed"
        | "window-disposed";
    };

function disposalReason(
  cause: OperationDisposalCause,
): Extract<AppRunOperationOutcome, { kind: "cancelled" }>["reason"] {
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

export const appRunOperationRegistry = new OperationRegistry<
  AppRunOperationOutcome,
  AppRunInvocationRef
>({
  maxUnresolved: 256,
  maxSettledReplay: 0,
  now: Date.now,
  disposalOutcome: (cause) => ({
    kind: "cancelled",
    reason: disposalReason(cause),
  }),
  supersededOutcome: () => ({
    kind: "cancelled",
    reason: "superseded",
  }),
  enqueueFailureOutcome: (error) => ({
    kind: "failed",
    operation: "run",
    error: {
      message: error instanceof Error ? error.message : String(error),
    },
  }),
});
