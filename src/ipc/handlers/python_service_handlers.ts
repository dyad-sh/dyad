import { ipcHost } from "../ipc_host";
import { spawn, ChildProcess } from "child_process";
import path from "node:path";
import fetch from "node-fetch";

let pythonProcess: ChildProcess | null = null;

export function registerPythonServiceHandlers() {
  ipcHost.handle("python:start", async () => {
    if (pythonProcess) {
      return { success: true, message: "Python service is already running." };
    }

    const scriptPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "python",
      "service.py",
    );
    // In production, we should use a packaged python executable.
    // For now, we'll assume python is in the PATH.
    pythonProcess = spawn("python", [scriptPath]);

    pythonProcess.stdout?.on("data", (data) => {
      console.log(`Python service stdout: ${data}`);
    });

    pythonProcess.stderr?.on("data", (data) => {
      console.error(`Python service stderr: ${data}`);
    });

    pythonProcess.on("close", (code) => {
      console.log(`Python service exited with code ${code}`);
      pythonProcess = null;
    });

    // Wait for the python server to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    return { success: true, message: "Python service started." };
  });

  ipcHost.handle("python:stop", async () => {
    if (pythonProcess) {
      pythonProcess.kill();
      pythonProcess = null;
      return { success: true, message: "Python service stopped." };
    }
    return { success: false, message: "Python service is not running." };
  });

  ipcHost.handle("python:train", async () => {
    try {
      const response = await fetch("http://127.0.0.1:5001/train", {
        method: "POST",
      });
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      if (error instanceof Error) {
        return { success: false, error: error.message };
      }
      return { success: false, error: "An unknown error occurred" };
    }
  });

  ipcHost.handle("python:status", async () => {
    try {
      const response = await fetch("http://127.0.0.1:5001/status");
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      if (error instanceof Error) {
        return { success: false, error: error.message };
      }
      return { success: false, error: "An unknown error occurred" };
    }
  });
}
