import { DyadError, DyadErrorKind, isDyadError } from "@/errors/dyad_error";
import type { SandboxHostCallName } from "./capabilities";
import type { SandboxRunResult } from "./execution";

export interface SandboxWorkerInput {
  appPath: string;
  script: string;
  timeoutMs: number;
  persistFullOutput?: boolean;
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

export type SandboxWorkerMessage =
  | { type: "hostCall"; hostCall: SandboxWorkerHostCall }
  | { type: "result"; result: SandboxRunResult }
  | { type: "error"; error: SerializedSandboxWorkerError };

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
