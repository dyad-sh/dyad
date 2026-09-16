import path from "path";
import { spawn, type ChildProcess } from "child_process";

function waitForReady(
  child: ChildProcess,
  readyText: string,
  label: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} failed to start within timeout`));
    }, 10_000);
    child.stdout?.on("data", (data: Buffer) => {
      if (data.toString().includes(readyText)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      reject(
        new Error(
          `${label} exited before ready (code=${code} signal=${signal})`,
        ),
      );
    });
  });
}

/**
 * Starts the fake http MCP server the catalog's `e2e-open` entry points
 * at (port 3002). Returns a function that stops it.
 */
export async function startFakeHttpMcpServer(): Promise<() => Promise<void>> {
  const child = spawn(
    "node",
    [path.join(__dirname, "..", "..", "testing", "fake-http-mcp-server.mjs")],
    { env: { ...process.env, PORT: "3002" }, stdio: "pipe" },
  );
  await waitForReady(child, "HTTP MCP server running", "http server");
  return async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await new Promise<void>((resolve) => {
      child.on("exit", () => resolve());
      setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 2000);
    });
  };
}
