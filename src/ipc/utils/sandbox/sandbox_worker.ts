import { parentPort, workerData } from "node:worker_threads";
import { buildSandboxCapabilitiesWithObserver } from "./capabilities";
import { executeSandboxScriptInProcess } from "./execution";
import {
  createRemoteCapabilityProxies,
  type RemoteCapabilityMap,
} from "./remote_capabilities";
import {
  serializeSandboxWorkerError,
  type SandboxWorkerInput,
  type SandboxWorkerMessage,
} from "./worker_protocol";

function getParentPort(): NonNullable<typeof parentPort> {
  if (!parentPort) {
    throw new Error("Sandbox worker must run inside a worker thread.");
  }
  return parentPort;
}

const port = getParentPort();

function postToHost(message: SandboxWorkerMessage): void {
  port.postMessage(message);
}

async function run() {
  const input = workerData as SandboxWorkerInput;

  // File host functions run here, in the worker. Main-thread-only host
  // functions are proxied over the port and served by the runner.
  const remote = createRemoteCapabilityProxies(
    input.remoteCapabilityNames ?? [],
    postToHost,
  );
  const onReply = (message: unknown) => {
    remote.receive(message);
  };
  port.on("message", onReply);

  const fileCapabilities = buildSandboxCapabilitiesWithObserver(
    input.appPath,
    (hostCall) => {
      postToHost({ type: "hostCall", hostCall });
    },
  ) as unknown as RemoteCapabilityMap;
  const capabilities: RemoteCapabilityMap = {
    ...fileCapabilities,
    ...remote.capabilities,
  };

  try {
    const result = await executeSandboxScriptInProcess({
      appPath: input.appPath,
      script: input.script,
      timeoutMs: input.timeoutMs,
      persistFullOutput: input.persistFullOutput,
      capabilities,
      onVmBudgetStart: () => postToHost({ type: "vmBudgetStart" }),
      onVmBudgetPause: () => postToHost({ type: "vmBudgetPause" }),
      onVmBudgetResume: () => postToHost({ type: "vmBudgetResume" }),
    });
    postToHost({ type: "result", result });
  } finally {
    port.off("message", onReply);
    remote.dispose();
  }
}

void run().catch((error) => {
  postToHost({ type: "error", error: serializeSandboxWorkerError(error) });
});
