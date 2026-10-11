import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { SandboxHostCallName } from "./capabilities";
import type { SandboxRunResult } from "./execution";

export interface SandboxWorkerInput {
  appPath: string;
  script: string;
  timeoutMs: number;
  persistFullOutput?: boolean;
  /**
   * Host functions that only exist on the main thread (write_file, MCP
   * tools). The worker exposes a proxy for each name that forwards the call
   * over the message port and awaits the main thread's reply.
   */
  remoteCapabilityNames?: string[];
}

export interface SandboxWorkerHostCall {
  name: SandboxHostCallName;
  path?: string;
}

export interface SerializedSandboxWorkerError {
  name?: string;
  message: string;
  kind?: DyadErrorKind;
  stack?: string;
}

/** A guest call to a main-thread host function, sent worker → main. */
export interface SandboxRemoteCallMessage {
  type: "remoteCall";
  callId: number;
  name: string;
  args: unknown[];
}

/** Messages sent worker → main. */
export type SandboxWorkerMessage =
  | { type: "vmBudgetStart" }
  | { type: "vmBudgetPause" }
  | { type: "vmBudgetResume" }
  | { type: "hostCall"; hostCall: SandboxWorkerHostCall }
  | SandboxRemoteCallMessage
  | { type: "result"; result: SandboxRunResult }
  | { type: "error"; error: SerializedSandboxWorkerError };

/** Messages sent main → worker: replies to remote host-function calls. */
export type SandboxHostMessage =
  | { type: "remoteResult"; callId: number; value: unknown }
  | {
      type: "remoteError";
      callId: number;
      error: SerializedSandboxWorkerError;
    };

export function serializeSandboxWorkerError(
  error: unknown,
): SerializedSandboxWorkerError {
  if (isDyadError(error)) {
    return {
      name: error.name,
      message: error.message,
      kind: error.kind,
      stack: error.stack,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    message: String(error),
  };
}

function isDyadErrorKind(value: unknown): value is DyadErrorKind {
  return (
    typeof value === "string" &&
    Object.values(DyadErrorKind).includes(value as DyadErrorKind)
  );
}

export function deserializeSandboxWorkerError(
  error: SerializedSandboxWorkerError,
): Error {
  if (isDyadErrorKind(error.kind)) {
    const dyadError = new DyadError(error.message, error.kind);
    dyadError.stack = error.stack;
    return dyadError;
  }

  const genericError = new Error(error.message);
  genericError.name = error.name ?? genericError.name;
  genericError.stack = error.stack;
  return genericError;
}
