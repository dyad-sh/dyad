import log from "electron-log";
import type { ActorHostError } from "@/distributed_machines/actor_host";
import {
  reportableErrorName,
  reportableStack,
  sendTelemetryException,
  shouldFilterTelemetryException,
  stackFrames,
} from "@/ipc/utils/telemetry";
import type { DispatcherErrorStage } from "@/state_machines/dispatcher";

const logger = log.scope("distributed_machines");

// Typed as a Record so a stage added to DispatcherErrorStage fails to compile
// until it is listed here.
const DISPATCHER_STAGES: Record<DispatcherErrorStage, true> = {
  transition: true,
  validation: true,
  "before-commit": true,
  projection: true,
  subscriber: true,
  observer: true,
  outcome: true,
  scheduler: true,
  command: true,
  "command-error-mapper": true,
};
const DISPATCHER_STAGE_NAMES = new Set<unknown>(Object.keys(DISPATCHER_STAGES));

interface Failure {
  error: unknown;
  stage?: DispatcherErrorStage;
  commandType?: string;
}

/**
 * The dispatcher wraps its failures with the stage and command they hit.
 * Anything else, including an object with an unknown `stage`, is the failure
 * itself.
 */
function unwrapStage(failure: unknown): Failure {
  if (
    typeof failure === "object" &&
    failure !== null &&
    "stage" in failure &&
    DISPATCHER_STAGE_NAMES.has(failure.stage) &&
    "error" in failure
  ) {
    const command = "command" in failure ? failure.command : undefined;
    const type =
      typeof command === "object" && command !== null && "type" in command
        ? command.type
        : undefined;
    return {
      error: failure.error,
      stage: failure.stage as DispatcherErrorStage,
      commandType: typeof type === "string" ? type : undefined,
    };
  }
  return { error: failure };
}

/**
 * Send only values from fixed sets: a listed error name, the reduced stack and
 * the given context. Never the message, which here can hold machine state,
 * such as a validation error that prints the whole state, which includes the
 * user's prompt.
 */
function sendWithoutMessage(
  error: unknown,
  context: Record<string, unknown>,
): void {
  if (shouldFilterTelemetryException(error)) return;
  const original = error instanceof Error ? error : new Error();
  const redacted = new Error();
  redacted.name = reportableErrorName(original);
  redacted.message = "";
  // Always a string: without one, the renderer reports its own stack instead
  // (see createExceptionFromTelemetry).
  redacted.stack = reportableStack(original);
  sendTelemetryException(redacted, context);
}

/**
 * Log and report an unexpected failure in a main-process state machine, such
 * as a command that throws. Expected failures are events, not reports.
 *
 * `machineId` names a definition the host registered, so it is one of the IDs
 * written in code. The command type is only logged, since nothing checks it
 * against a fixed set.
 */
export function reportActorHostError({
  machineId,
  key,
  failure,
}: ActorHostError): void {
  try {
    const { error, stage, commandType } = unwrapStage(failure);
    logger.error(
      `State machine ${machineId} failed${stage ? ` in ${stage}` : ""}${
        commandType ? ` (${commandType})` : ""
      }, key:`,
      key,
      describeForLog(error),
    );
    sendWithoutMessage(error, {
      source: `state_machine:${machineId}`,
      ...(stage ? { phase: stage } : {}),
    });
  } catch {
    // Reporting must not become another failure in the machine.
  }
}

const MAX_LOGGED_MESSAGE_CHARS = 300;

/**
 * The failure as the log keeps it: the first line of its message and its
 * frames. The rest of a message can hold machine state, such as a validation
 * error that prints the whole state, and recent log lines go into bug reports.
 */
function describeForLog(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const firstLine = String(text)
    .split("\n", 1)[0]
    .slice(0, MAX_LOGGED_MESSAGE_CHARS);
  if (!(error instanceof Error)) return firstLine;
  return [
    `${reportableErrorName(error)}: ${firstLine}`,
    ...stackFrames(error),
  ].join("\n");
}

/** Log and report a failure sending machine state or results to a window. */
export function reportRemoteTransportError(error: unknown): void {
  try {
    logger.error("State machine transport failed:", describeForLog(error));
    sendWithoutMessage(error, { source: "state_machine_transport" });
  } catch {
    // Reporting must not break the transport.
  }
}
