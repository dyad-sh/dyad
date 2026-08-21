import { exec } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import net from "node:net";
import log from "electron-log";

import type {
  DiscoveryProvider,
  HealthProbe,
  ServiceCandidate,
} from "@/lib/infrastructure/types";

/**
 * Providers that inspect the machine this app is running on.
 *
 * Each one answers a narrow question ("what is listening?", "what containers
 * exist?") and reports what it saw. None of them knows what any of it means,
 * and none may name a product: recognising things is the identifier plugins'
 * job, and keeping that separation is what lets a service nobody has heard of
 * still appear on the dashboard.
 *
 * Every provider declares whether it can run here, so a machine without Docker
 * simply skips that strategy rather than reporting an error nobody can act on.
 */

const run = promisify(exec);
const logger = log.scope("infrastructure");

/** Long enough for a slow container daemon, short enough to keep scans brisk. */
const COMMAND_TIMEOUT_MS = 8_000;

/** Runs a command, returning empty output rather than throwing. */
async function tryRun(command: string): Promise<string> {
  try {
    const { stdout } = await run(command, {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return stdout;
  } catch {
    // A missing tool or a non-zero exit is a normal outcome here.
    return "";
  }
}

async function commandExists(name: string): Promise<boolean> {
  const found = await tryRun(
    process.platform === "win32" ? `where ${name}` : `command -v ${name}`,
  );
  return found.trim().length > 0;
}

/**
 * What is listening, from lsof.
 *
 * The strongest signal available: a port someone can connect to is a service
 * whether or not anything recognises it. Loopback and wildcard binds are both
 * kept, because a service bound to 0.0.0.0 is still a service.
 */
export const portProvider: DiscoveryProvider = {
  source: "port",
  label: "Listening ports",
  available: async () =>
    process.platform !== "win32" && (await commandExists("lsof")),
  discover: async () => {
    // -nP keeps numbers numeric so nothing has to be un-resolved later.
    const output = await tryRun("lsof -nP -iTCP -sTCP:LISTEN");
    const candidates: ServiceCandidate[] = [];

    for (const line of output.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 9) continue;

      const [processName, pidText] = parts;
      const address = parts[8] ?? "";
      const match = /^(.*):(\d+)$/.exec(address);
      if (!match) continue;

      const host = match[1] === "*" ? "0.0.0.0" : (match[1] ?? "");
      const port = Number(match[2]);
      if (!Number.isFinite(port)) continue;

      candidates.push({
        source: "port",
        processName,
        pid: Number(pidText) || undefined,
        protocol: "tcp",
        // Probing a wildcard bind is done against loopback, which is where
        // this machine can actually reach it.
        host: host === "0.0.0.0" || host === "*" ? "127.0.0.1" : host,
        port,
        metadata: { bind: host },
      });
    }
    return candidates;
  },
};

/**
 * Long-running processes, from ps.
 *
 * Catches the workers that never listen on anything, which a port scan cannot
 * see and which are often exactly what has died when something is wrong.
 */
export const processProvider: DiscoveryProvider = {
  source: "process",
  label: "Running processes",
  available: async () => process.platform !== "win32",
  discover: async () => {
    const output = await tryRun("ps -Ao pid=,comm=,%cpu=,%mem=");
    const candidates: ServiceCandidate[] = [];

    for (const line of output.split("\n")) {
      const match = /^\s*(\d+)\s+(\S+)\s+([\d.]+)\s+([\d.]+)\s*$/.exec(line);
      if (!match) continue;

      const command = match[2] ?? "";
      const name = command.split("/").pop() ?? command;

      // Kernel threads and the app itself are noise on this dashboard.
      if (name.startsWith("(") || name === "ps") continue;

      candidates.push({
        source: "process",
        processName: name,
        pid: Number(match[1]),
        metadata: {
          command,
          cpu: match[3] ?? "0",
          memory: match[4] ?? "0",
        },
      });
    }
    return candidates;
  },
};

/**
 * Containers, from the Docker CLI.
 *
 * Uses the CLI rather than the socket so it works with Docker Desktop, colima,
 * podman's docker shim and anything else that provides the command, without
 * this file needing to know which.
 */
export const dockerProvider: DiscoveryProvider = {
  source: "docker",
  label: "Docker containers",
  available: async () => {
    if (!(await commandExists("docker"))) return false;
    // Installed is not the same as running.
    return (
      (await tryRun("docker info --format '{{.ServerVersion}}'")).trim()
        .length > 0
    );
  },
  discover: async () => {
    const format =
      "{{.ID}}\\t{{.Names}}\\t{{.Image}}\\t{{.Ports}}\\t{{.State}}\\t{{.Status}}";
    const output = await tryRun(`docker ps --no-trunc --format "${format}"`);
    const candidates: ServiceCandidate[] = [];

    for (const line of output.split("\n")) {
      if (!line.trim()) continue;
      const [id, names, image, ports, state, status] = line.split("\t");
      if (!id) continue;

      const published = [
        ...(ports ?? "").matchAll(/(?:([\d.]+|\[::\]):)?(\d+)->(\d+)\/tcp/g),
      ];

      const shared = {
        source: "docker" as const,
        containerId: id,
        containerImage: image,
        suggestedName: names,
        metadata: {
          state: state ?? "",
          status: status ?? "",
          image: image ?? "",
        },
      };

      if (published.length === 0) {
        // A container with nothing published is still running and still worth
        // listing; it simply has no endpoint to probe.
        candidates.push(shared);
        continue;
      }

      for (const match of published) {
        candidates.push({
          ...shared,
          protocol: "tcp",
          host: "127.0.0.1",
          port: Number(match[2]),
          metadata: { ...shared.metadata, containerPort: match[3] ?? "" },
        });
      }
    }
    return candidates;
  },
};

/**
 * launchd services on macOS.
 *
 * Only those loaded by the current user: system daemons are numerous, mostly
 * Apple's, and drown out anything the user actually installed.
 */
export const launchdProvider: DiscoveryProvider = {
  source: "launchd",
  label: "launchd services",
  available: async () => process.platform === "darwin",
  discover: async () => {
    const output = await tryRun("launchctl list");
    const candidates: ServiceCandidate[] = [];

    for (const line of output.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      const [pidText, statusText, label] = parts;
      if (!label || label.startsWith("com.apple.")) continue;

      const pid = Number(pidText);
      candidates.push({
        source: "launchd",
        systemServiceName: label,
        pid: Number.isFinite(pid) && pid > 0 ? pid : undefined,
        metadata: { lastExitStatus: statusText ?? "" },
      });
    }
    return candidates;
  },
};

/** systemd units on Linux. */
export const systemdProvider: DiscoveryProvider = {
  source: "systemd",
  label: "systemd units",
  available: async () =>
    process.platform === "linux" && (await commandExists("systemctl")),
  discover: async () => {
    const output = await tryRun(
      "systemctl list-units --type=service --state=running --no-pager --no-legend --plain",
    );
    const candidates: ServiceCandidate[] = [];

    for (const line of output.split("\n")) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const unit = parts[0];
      if (!unit?.endsWith(".service")) continue;

      candidates.push({
        source: "systemd",
        systemServiceName: unit,
        metadata: { active: parts[2] ?? "", sub: parts[3] ?? "" },
      });
    }
    return candidates;
  },
};

/** Every provider bundled today, in the order their output is merged. */
export const LOCAL_PROVIDERS: DiscoveryProvider[] = [
  portProvider,
  dockerProvider,
  processProvider,
  launchdProvider,
  systemdProvider,
];

/**
 * Runs a probe.
 *
 * Failures are answers, not exceptions: "did not respond" is exactly the
 * information a monitor exists to provide, so nothing here throws.
 */
export async function runProbe(
  probe: HealthProbe,
  timeoutMs = 3_000,
): Promise<{
  status: "healthy" | "degraded" | "offline" | "unknown";
  latencyMs?: number;
}> {
  const startedAt = Date.now();

  if (probe.kind === "none") return { status: "unknown" };

  if (probe.kind === "http") {
    try {
      const response = await fetch(probe.url, {
        method: probe.method,
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Any answer proves something is listening and speaking HTTP. A 404 from
      // a guessed path says the service is up, not that it is broken.
      return {
        status: response.status >= 500 ? "degraded" : "healthy",
        latencyMs: Date.now() - startedAt,
      };
    } catch {
      return { status: "offline" };
    }
  }

  if (probe.kind === "tcp") {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      const finish = (status: "healthy" | "offline") => {
        socket.destroy();
        resolve(
          status === "healthy"
            ? { status, latencyMs: Date.now() - startedAt }
            : { status },
        );
      };
      socket.setTimeout(timeoutMs);
      socket.once("connect", () => finish("healthy"));
      socket.once("timeout", () => finish("offline"));
      socket.once("error", () => finish("offline"));
      socket.connect(probe.port, probe.host);
    });
  }

  if (probe.kind === "docker") {
    const state = (
      await tryRun(
        `docker inspect --format "{{.State.Health.Status}}|{{.State.Running}}" ${probe.containerId}`,
      )
    ).trim();
    if (!state) return { status: "unknown" };
    const [health, running] = state.split("|");
    // A container with a healthcheck is judged by it; one without is judged
    // only on whether it is running, which is all Docker actually knows.
    if (health && health !== "<no value>" && health !== "") {
      if (health === "healthy") return { status: "healthy" };
      if (health === "starting") return { status: "unknown" };
      if (health === "unhealthy") return { status: "degraded" };
    }
    return { status: running === "true" ? "healthy" : "offline" };
  }

  // A process is alive if signal 0 does not throw.
  try {
    process.kill(probe.pid, 0);
    return { status: "healthy" };
  } catch {
    return { status: "offline" };
  }
}

/** This machine, as a node. */
export function localNode() {
  return {
    id: "local",
    name: os.hostname(),
    platform: `${os.type()} ${os.release()}`,
    lastSeenAt: Date.now(),
    reachable: true,
  };
}

export { logger as infrastructureLogger };
