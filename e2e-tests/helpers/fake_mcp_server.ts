import path from "path";
import { spawn, type ChildProcess } from "child_process";

const SCRIPTS_DIR = path.join(__dirname, "..", "..", "testing");

function waitForReady(
  child: ChildProcess,
  readyText: string,
  label: string,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      // Do not leave a hung child holding the port behind a failed test.
      child.kill("SIGKILL");
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
    // Fail fast if the process dies before it is ready, instead of
    // hanging until the timeout with a generic message.
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

// Resolves only once the child has exited, so the port is free for the
// next test even when the graceful signal had to be escalated.
function stop(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const forceKill = setTimeout(() => child.kill("SIGKILL"), 2_000);
    child.once("exit", () => {
      clearTimeout(forceKill);
      resolve();
    });
    child.kill();
  });
}

async function startFakeServer({
  script,
  port,
  env = {},
  readyText,
  label,
}: {
  script: string;
  port: number;
  env?: NodeJS.ProcessEnv;
  readyText: string;
  label: string;
}): Promise<() => Promise<void>> {
  const child = spawn("node", [path.join(SCRIPTS_DIR, script)], {
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: "pipe",
  });
  await waitForReady(child, readyText, label);
  return () => stop(child);
}

/** Default port of the fake catalog's `e2e-open` and `e2e-headers` entries. */
export const DEFAULT_FAKE_HTTP_MCP_PORT = 3002;
/** Default port of the fake catalog's `e2e-oauth` entry. */
export const DEFAULT_FAKE_OAUTH_MCP_PORT = 4010;

/** Starts the fake http MCP server. Returns a function that stops it. */
export function startFakeHttpMcpServer(
  port = DEFAULT_FAKE_HTTP_MCP_PORT,
): Promise<() => Promise<void>> {
  return startFakeServer({
    script: "fake-http-mcp-server.mjs",
    port,
    readyText: "HTTP MCP server running",
    label: "http server",
  });
}

/** Starts the fake OAuth MCP server. Returns a function that stops it. */
export function startFakeOauthMcpServer(
  port = DEFAULT_FAKE_OAUTH_MCP_PORT,
): Promise<() => Promise<void>> {
  return startFakeServer({
    script: "fake-oauth-mcp-server.mjs",
    port,
    env: { FAKE_DCR: "1" },
    readyText: "Fake OAuth MCP server listening",
    label: "oauth server",
  });
}
