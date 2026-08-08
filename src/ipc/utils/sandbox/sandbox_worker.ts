import { parentPort, workerData } from "node:worker_threads";
import { executeSandboxScriptInProcess } from "./execution";
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

async function run() {
  const input = workerData as SandboxWorkerInput;
  const result = await executeSandboxScriptInProcess({
    appPath: input.appPath,
    script: input.script,
    timeoutMs: input.timeoutMs,
    persistFullOutput: input.persistFullOutput,
    onHostCall: (hostCall) => {
      port.postMessage({
        type: "hostCall",
        hostCall,
      } satisfies SandboxWorkerMessage);
    },
  });

  port.postMessage({
    type: "result",
    result,
  } satisfies SandboxWorkerMessage);
}

void run().catch((error) => {
  port.postMessage({
    type: "error",
    error: serializeSandboxWorkerError(error),
  } satisfies SandboxWorkerMessage);
});
