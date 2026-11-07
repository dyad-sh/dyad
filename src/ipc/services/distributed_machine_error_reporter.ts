import log from "electron-log";
import type { ActorHostError } from "@/distributed_machines/actor_host";
import {
  framesOnly,
  sendTelemetryException,
  shouldFilterTelemetryException,
} from "@/ipc/utils/telemetry";

const logger = log.scope("distributed_machines");

const COMMAND_TYPE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

interface Failure {
  error: unknown;
  stage?: string;
  commandType?: string;
}

/** The dispatcher wraps its failures with the stage and command they hit. */
function unwrapStage(failure: unknown): Failure {
  if (
    typeof failure === "object" &&
    failure !== null &&
    "stage" in failure &&
    typeof failure.stage === "string" &&
    "error" in failure
  ) {
    const command = "command" in failure ? failure.command : undefined;
    const type =
      typeof command === "object" && command !== null && "type" in command
        ? command.type
        : undefined;
    return {
      error: failure.error,
      stage: failure.stage,
      commandType:
        typeof type === "string" && COMMAND_TYPE.test(type) ? type : undefined,
    };
  }
  return { error: failure };
}

/**
 * Send the error's name and stack frames, never its message. Messages here
 * can hold machine state, such as a validation error that prints the whole
 * state, which includes the user's prompt.
 */
function sendWithoutMessage(
  error: unknown,
  context: Record<string, unknown>,
): void {
  if (shouldFilterTelemetryException(error)) return;
  const original = error instanceof Error ? error : new Error();
  const redacted = new Error();
  redacted.name = original.name;
  redacted.message = "";
  redacted.stack = framesOnly(original);
  sendTelemetryException(redacted, context);
}

/**
 * Log and report an unexpected failure in a main-process state machine, such
 * as a command that throws. Expected failures are events, not reports.
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
      error,
    );
    sendWithoutMessage(error, {
      source: `state_machine:${machineId}`,
      ...(stage ? { phase: stage } : {}),
      ...(commandType ? { command_type: commandType } : {}),
    });
  } catch {
    // Reporting must not become another failure in the machine.
  }
}

/** Log and report a failure sending machine state or results to a window. */
export function reportRemoteTransportError(error: unknown): void {
  try {
    logger.error("State machine transport failed:", error);
    sendWithoutMessage(error, { source: "state_machine_transport" });
  } catch {
    // Reporting must not break the transport.
  }
}
