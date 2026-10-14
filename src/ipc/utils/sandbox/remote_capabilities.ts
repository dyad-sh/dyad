import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  deserializeSandboxWorkerError,
  serializeSandboxWorkerError,
  type SandboxHostMessage,
  type SandboxRemoteCallMessage,
} from "./worker_protocol";

export type RemoteCapabilityMap = Record<
  string,
  (...args: unknown[]) => unknown
>;

interface PendingRemoteCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Worker side of the host-function bridge.
 *
 * Main-thread-only host functions (write_file, MCP tools) close over live
 * main-process objects — the MCP client registry, the IPC event used for
 * consent prompts, the UI streaming callback — so they cannot be handed to a
 * worker. Instead the worker exposes one proxy per name; a guest call posts a
 * `remoteCall` and resolves when the main thread replies. The transport is
 * injected so the correlation logic can be tested without a real worker.
 */
export function createRemoteCapabilityProxies(
  names: readonly string[],
  post: (message: SandboxRemoteCallMessage) => void,
): {
  capabilities: RemoteCapabilityMap;
  /** Feed every main → worker message here. Returns false if it was not a reply. */
  receive: (message: unknown) => boolean;
  /** Reject every call still in flight, e.g. when the worker shuts down. */
  dispose: (reason?: Error) => void;
  readonly pendingCount: number;
} {
  const pending = new Map<number, PendingRemoteCall>();
  let nextCallId = 1;

  const capabilities: RemoteCapabilityMap = {};
  for (const name of names) {
    capabilities[name] = (...args: unknown[]) =>
      new Promise<unknown>((resolve, reject) => {
        const callId = nextCallId++;
        pending.set(callId, { resolve, reject });
        try {
          post({ type: "remoteCall", callId, name, args });
        } catch (error) {
          // Typically a DataCloneError: the guest passed something that
          // cannot cross the thread boundary. Surface it as the call's error.
          pending.delete(callId);
          reject(
            new DyadError(
              `Host function ${name} received an argument that cannot cross the worker boundary: ${
                error instanceof Error ? error.message : String(error)
              }`,
              DyadErrorKind.Validation,
            ),
          );
        }
      });
  }

  return {
    capabilities,
    receive(message: unknown): boolean {
      const reply = message as SandboxHostMessage | null | undefined;
      if (
        !reply ||
        typeof reply !== "object" ||
        (reply.type !== "remoteResult" && reply.type !== "remoteError")
      ) {
        return false;
      }
      const call = pending.get(reply.callId);
      if (!call) {
        // A late reply after dispose(); nothing is waiting for it.
        return true;
      }
      pending.delete(reply.callId);
      if (reply.type === "remoteResult") {
        call.resolve(reply.value);
      } else {
        call.reject(deserializeSandboxWorkerError(reply.error));
      }
      return true;
    },
    dispose(reason?: Error) {
      const error =
        reason ??
        new DyadError(
          "Sandbox host call abandoned because the script stopped.",
          DyadErrorKind.Internal,
        );
      for (const call of pending.values()) {
        call.reject(error);
      }
      pending.clear();
    },
    get pendingCount() {
      return pending.size;
    },
  };
}

/**
 * Main side of the host-function bridge: executes a worker's `remoteCall`
 * against the real capability and posts the outcome back. Errors keep their
 * `DyadErrorKind` across the boundary so consent denial, validation and
 * precondition failures reach the guest with the same classification as an
 * in-process call.
 */
export function createRemoteCallDispatcher(
  capabilities: RemoteCapabilityMap,
  post: (message: SandboxHostMessage) => void,
): {
  dispatch: (call: SandboxRemoteCallMessage) => Promise<void>;
  readonly inFlightCount: number;
} {
  let inFlight = 0;

  const postError = (callId: number, error: unknown) => {
    post({
      type: "remoteError",
      callId,
      error: serializeSandboxWorkerError(error),
    });
  };

  return {
    async dispatch(call) {
      const capability = Object.hasOwn(capabilities, call.name)
        ? capabilities[call.name]
        : undefined;
      if (typeof capability !== "function") {
        postError(
          call.callId,
          new DyadError(
            `Unknown sandbox host function: ${call.name}`,
            DyadErrorKind.Internal,
          ),
        );
        return;
      }
      inFlight += 1;
      try {
        const value = await capability(...call.args);
        try {
          post({ type: "remoteResult", callId: call.callId, value });
        } catch (error) {
          // The result is not structured-cloneable (functions, class
          // instances). Report it as the call's failure rather than letting
          // the guest hang on a reply that never arrives.
          postError(
            call.callId,
            new DyadError(
              `Host function ${call.name} returned a value that cannot cross the worker boundary: ${
                error instanceof Error ? error.message : String(error)
              }`,
              DyadErrorKind.Internal,
            ),
          );
        }
      } catch (error) {
        postError(call.callId, error);
      } finally {
        inFlight -= 1;
      }
    },
    get inFlightCount() {
      return inFlight;
    },
  };
}
