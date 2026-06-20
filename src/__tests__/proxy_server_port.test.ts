import net from "node:net";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { afterEach, describe, expect, it } from "vitest";

const WORKER_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "worker",
  "proxy_server.js",
);

/** Binds a TCP listener and resolves once it is actively occupying `port`. */
function occupyPort(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(port, "localhost", () => resolve(server));
  });
}

/** Finds a currently-free localhost port (closed before returning). */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "localhost", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function close(server: net.Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("proxy worker port fallback", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanup.splice(0)) {
      await fn();
    }
  });

  function startWorker(workerData: Record<string, unknown>): {
    worker: Worker;
    messages: string[];
    waitFor: (predicate: (m: string) => boolean) => Promise<string>;
  } {
    const worker = new Worker(WORKER_PATH, { workerData });
    cleanup.push(async () => {
      await worker.terminate();
    });
    const messages: string[] = [];
    const waiters: Array<{
      predicate: (m: string) => boolean;
      resolve: (m: string) => void;
    }> = [];
    worker.on("message", (m) => {
      if (typeof m !== "string") return;
      messages.push(m);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(m)) {
          waiters[i].resolve(m);
          waiters.splice(i, 1);
        }
      }
    });
    const waitFor = (predicate: (m: string) => boolean) =>
      new Promise<string>((resolve, reject) => {
        const existing = messages.find(predicate);
        if (existing) return resolve(existing);
        const timer = setTimeout(
          () => reject(new Error("Timed out waiting for worker message")),
          10_000,
        );
        waiters.push({
          predicate,
          resolve: (m) => {
            clearTimeout(timer);
            resolve(m);
          },
        });
      });
    return { worker, messages, waitFor };
  }

  it("binds to the fallback band when the preferred port is taken", async () => {
    const base = await findFreePort();
    const occupied = await occupyPort(base);
    cleanup.push(() => close(occupied));

    const fallbackPortStart = await findFreePort();

    const { waitFor } = startWorker({
      targetOrigin: "http://localhost:5173",
      port: base,
      fallbackPortStart,
      maxPortAttempts: 20,
    });

    const startMsg = await waitFor((m) =>
      m.startsWith("proxy-server-start url="),
    );

    expect(startMsg).toContain(`:${fallbackPortStart}`);
    expect(startMsg).not.toContain(`:${base}`);
    // The foreign service on the preferred port is left running.
    expect(occupied.listening).toBe(true);
  });

  it("reports an error when every candidate port is taken", async () => {
    const base = await findFreePort();
    const fallbackPortStart = await findFreePort();
    const occupiedBase = await occupyPort(base);
    const occupiedFallback = await occupyPort(fallbackPortStart);
    cleanup.push(() => close(occupiedBase));
    cleanup.push(() => close(occupiedFallback));

    const { waitFor } = startWorker({
      targetOrigin: "http://localhost:5173",
      port: base,
      fallbackPortStart,
      // Only two candidates (base + fallbackPortStart), both occupied.
      maxPortAttempts: 2,
    });

    const errMsg = await waitFor((m) => m.startsWith("proxy-server-error"));
    expect(errMsg).toContain("EADDRINUSE");
  });
});
