import { spawn, type ChildProcess } from "child_process";
import * as net from "net";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  findSshBinary,
  isSshAvailable,
  keyFilePath,
  runRemote,
  sshDestination,
  SSH_BASE_ARGS,
  type SshTarget,
} from "./ssh_utils";

const logger = log.scope("ssh_tunnel");

// A Coolify-managed database is deliberately not published to the host: its
// container joins a docker network and nothing binds a host port. The host can
// still route to the container's bridge IP, so `ssh -L` forwards there. This
// keeps the database unreachable from the internet, and the SSH channel also
// supplies the transport encryption the database itself does not have (Coolify
// leaves SSL off and does not expose a way to enable it through its API).

/** Resolves a container's IP on its docker network, as seen from the host. */
export async function resolveContainerIp(
  target: SshTarget,
  containerName: string,
): Promise<string> {
  if (!/^[A-Za-z0-9_.-]+$/.test(containerName)) {
    // The name is interpolated into a remote command, so keep it to the
    // character set docker actually allows.
    throw new DyadError(
      `Refusing to inspect unsafe container name: ${containerName}`,
      DyadErrorKind.Validation,
    );
  }
  const result = await runRemote(
    target,
    `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' ${containerName}`,
  );
  if (!result.ok) {
    throw new DyadError(
      `Could not inspect container ${containerName}: ${result.error}`,
      DyadErrorKind.External,
    );
  }
  // A container can be on several networks; take the first non-empty address.
  const ip = result.stdout.trim().split(/\s+/).filter(Boolean)[0];
  if (!ip) {
    throw new DyadError(
      `Container ${containerName} reported no IP address. Is it running?`,
      DyadErrorKind.External,
    );
  }
  return ip;
}

/** Asks the OS for a free localhost port to bind the tunnel's local end. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || address === null) {
        server.close(() => reject(new Error("Could not determine free port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      const retry = () => {
        socket.destroy();
        if (Date.now() > deadline) {
          resolve(false);
        } else {
          setTimeout(attempt, 200);
        }
      };
      socket.setTimeout(1000);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("timeout", retry);
      socket.on("error", retry);
    };
    attempt();
  });
}

export interface SshTunnel {
  /** Local port the tunnel listens on; connect to 127.0.0.1 at this port. */
  localPort: number;
  close: () => void;
}

/**
 * Opens `ssh -L <local>:<remoteHost>:<remotePort>` and resolves once the local
 * end accepts connections. The caller must always close the tunnel, including
 * on failure paths.
 */
export async function openSshTunnel({
  target,
  remoteHost,
  remotePort,
  readyTimeoutMs = 20_000,
}: {
  target: SshTarget;
  remoteHost: string;
  remotePort: number;
  readyTimeoutMs?: number;
}): Promise<SshTunnel> {
  if (!isSshAvailable()) {
    throw new DyadError(
      "OpenSSH client not found on this machine",
      DyadErrorKind.Validation,
    );
  }
  const localPort = await findFreePort();
  const args = [
    ...SSH_BASE_ARGS,
    "-p",
    String(target.port),
    "-i",
    keyFilePath(target.keyName),
    // -N: no remote command, forwarding only. -T: no TTY.
    "-N",
    "-T",
    "-L",
    `127.0.0.1:${localPort}:${remoteHost}:${remotePort}`,
    sshDestination(target),
  ];

  let child: ChildProcess | null = spawn(findSshBinary("ssh"), args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => (stderr += chunk.toString()));

  let exited = false;
  child.on("exit", () => (exited = true));
  // Without this, a spawn failure emits an unhandled 'error' event, which
  // Electron surfaces as a JavaScript error dialog from the main process.
  child.on("error", (err) => {
    exited = true;
    stderr += `\n${err.message}`;
    logger.error(`SSH tunnel process failed to start: ${err.message}`);
  });

  const close = () => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    child = null;
  };

  const ready = await waitForPort(localPort, readyTimeoutMs);
  if (!ready || exited) {
    close();
    throw new DyadError(
      `SSH tunnel to ${remoteHost}:${remotePort} did not open` +
        (stderr.trim() ? `: ${stderr.trim()}` : ""),
      DyadErrorKind.External,
    );
  }
  logger.info(
    `SSH tunnel open: 127.0.0.1:${localPort} -> ${remoteHost}:${remotePort}`,
  );
  return { localPort, close };
}

/**
 * Opens a tunnel to a database container, runs `fn` against a connection
 * string pointed at the local end, and always tears the tunnel down.
 */
export async function withDatabaseTunnel<T>(
  {
    target,
    containerName,
    remotePort = 5432,
  }: { target: SshTarget; containerName: string; remotePort?: number },
  fn: (rewriteConnectionString: (original: string) => string) => Promise<T>,
): Promise<T> {
  const ip = await resolveContainerIp(target, containerName);
  const tunnel = await openSshTunnel({
    target,
    remoteHost: ip,
    remotePort,
  });
  try {
    return await fn((original) => rewriteHostPort(original, tunnel.localPort));
  } finally {
    tunnel.close();
  }
}

/**
 * Points a connection string at the tunnel's local end, preserving
 * credentials, database name and query parameters.
 */
export function rewriteHostPort(
  connectionString: string,
  localPort: number,
): string {
  const url = new URL(connectionString);
  url.hostname = "127.0.0.1";
  url.port = String(localPort);
  // A self-hosted database generally has no TLS, and clients that default to
  // requiring it fail with "the server does not support SSL connections".
  // Privacy comes from the SSH channel the traffic is already inside.
  url.searchParams.set("sslmode", "disable");
  return url.toString();
}
