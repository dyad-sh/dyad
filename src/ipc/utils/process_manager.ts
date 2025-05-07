import { ChildProcess } from "node:child_process";
import treeKill from "tree-kill";

// Define a type for the value stored in runningApps
export interface RunningAppInfo {
  process: ChildProcess;
  processId: number;
}

// Store running app processes
export const runningApps = new Map<number, RunningAppInfo>();
// Global counter for process IDs
let processCounterValue = 0;

// Getter and setter for processCounter to allow modification from outside
export const processCounter = {
  get value(): number {
    return processCounterValue;
  },
  set value(newValue: number) {
    processCounterValue = newValue;
  },
  increment(): number {
    return ++processCounterValue;
  },
};

/**
 * Kills a running process with its child processes
 * @param process The child process to kill
 * @param pid The process ID
 * @returns A promise that resolves when the process is closed or timeout
 */
export function killProcess(process: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      console.warn(
        `Timeout waiting for process (PID: ${process.pid}) to close. Force killing may be needed.`,
      );
      resolve();
    }, 5000); // 5-second timeout

    process.on("close", (code, signal) => {
      clearTimeout(timeout);
      console.log(
        `Received 'close' event for process (PID: ${process.pid}) with code ${code}, signal ${signal}.`,
      );
      resolve();
    });

    // Handle potential errors during kill/close sequence
    process.on("error", (err) => {
      clearTimeout(timeout);
      console.error(
        `Error during stop sequence for process (PID: ${process.pid}): ${err.message}`,
      );
      resolve();
    });

    // Ensure PID exists before attempting to kill
    if (process.pid) {
      // Use tree-kill to terminate the entire process tree
      console.log(
        `Attempting to tree-kill process tree starting at PID ${process.pid}.`,
      );
      treeKill(process.pid, "SIGTERM", (err: Error | undefined) => {
        if (err) {
          console.warn(
            `tree-kill error for PID ${process.pid}: ${err.message}`,
          );
        } else {
          console.log(
            `tree-kill signal sent successfully to PID ${process.pid}.`,
          );
        }
      });
    } else {
      console.warn(`Cannot tree-kill process: PID is undefined.`);
    }
  });
}

/**
 * Removes an app from the running apps map if it's the current process
 * @param appId The app ID
 * @param process The process to check against
 */
export function removeAppIfCurrentProcess(
  appId: number,
  process: ChildProcess,
): void {
  const currentAppInfo = runningApps.get(appId);
  if (currentAppInfo && currentAppInfo.process === process) {
    runningApps.delete(appId);
    console.log(
      `Removed app ${appId} (processId ${currentAppInfo.processId}) from running map. Current size: ${runningApps.size}`,
    );
  } else {
    console.log(
      `App ${appId} process was already removed or replaced in running map. Ignoring.`,
    );
  }
}
