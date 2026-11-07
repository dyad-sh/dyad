import log from "electron-log";
import type { ActorHostError } from "@/distributed_machines/actor_host";
import { sendTelemetryException } from "@/ipc/utils/telemetry";

const logger = log.scope("distributed_machines");

/** The dispatcher wraps its failures with the stage they happened in. */
function unwrapStage(failure: unknown): { stage?: string; error: unknown } {
  if (
    typeof failure === "object" &&
    failure !== null &&
    "stage" in failure &&
    typeof failure.stage === "string" &&
    "error" in failure
  ) {
    return { stage: failure.stage, error: failure.error };
  }
  return { error: failure };
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
    const { stage, error } = unwrapStage(failure);
    logger.error(
      `State machine ${machineId} failed${stage ? ` in ${stage}` : ""}, key:`,
      key,
      error,
    );
    sendTelemetryException(error, {
      source: `state_machine:${machineId}`,
      ...(stage ? { phase: stage } : {}),
    });
  } catch {
    // Reporting must not become another failure in the machine.
  }
}

/** Log and report a failure sending machine state or results to a window. */
export function reportRemoteTransportError(error: unknown): void {
  try {
    logger.error("State machine transport failed:", error);
    sendTelemetryException(error, { source: "state_machine_transport" });
  } catch {
    // Reporting must not break the transport.
  }
}
