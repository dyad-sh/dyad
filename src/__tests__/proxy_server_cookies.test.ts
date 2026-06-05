import http from "node:http";
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

/**
 * Starts an upstream HTTP server that replies to every request with the given
 * Set-Cookie header(s) and a non-HTML body (so the proxy takes the
 * pass-through path rather than the HTML-injection path).
 */
function startUpstream(setCookie: string[]): Promise<{
  origin: string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "text/plain",
        "set-cookie": setCookie,
      });
      res.end("ok");
    });
    server.once("error", reject);
    server.listen(0, "localhost", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        origin: `http://localhost:${port}`,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

/** Issues a GET to the proxy and resolves with the raw Set-Cookie header. */
function getSetCookie(port: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "localhost", port, path: "/" }, (res) => {
      // Drain the body so the socket can close.
      res.on("data", () => {});
      res.on("end", () => resolve(res.headers["set-cookie"] ?? []));
    });
    req.once("error", reject);
  });
}

describe("proxy worker cookie rewriting", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanup.splice(0)) {
      await fn();
    }
  });

  function startWorker(workerData: Record<string, unknown>): {
    waitForStart: () => Promise<number>;
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
    return {
      waitForStart: async () => {
        const msg = await waitFor((m) =>
          m.startsWith("proxy-server-start url="),
        );
        const port = Number(msg.match(/:(\d+)\b/)?.[1]);
        return port;
      },
    };
  }

  async function proxyCookies(setCookie: string[]): Promise<string[]> {
    const upstream = await startUpstream(setCookie);
    cleanup.push(upstream.close);

    const port = await findFreePort();
    const { waitForStart } = startWorker({
      targetOrigin: upstream.origin,
      port,
      fallbackPortStart: await findFreePort(),
      maxPortAttempts: 20,
    });
    const proxyPort = await waitForStart();
    return getSetCookie(proxyPort);
  }

  it("forces SameSite=None; Secure; Partitioned on a default Lax cookie", async () => {
    const [cookie] = await proxyCookies([
      "session=abc123; Path=/; HttpOnly; SameSite=Lax",
    ]);

    expect(cookie).toContain("session=abc123");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*SameSite=None/i);
    expect(cookie).toMatch(/;\s*Partitioned/i);
    // The original restrictive SameSite must be gone.
    expect(cookie).not.toMatch(/SameSite=Lax/i);
  });

  it("does not duplicate attributes when already None/Secure/Partitioned", async () => {
    const [cookie] = await proxyCookies([
      "tok=v; Path=/; Secure; SameSite=None; Partitioned",
    ]);

    expect((cookie.match(/Secure/gi) ?? []).length).toBe(1);
    expect((cookie.match(/SameSite=None/gi) ?? []).length).toBe(1);
    expect((cookie.match(/Partitioned/gi) ?? []).length).toBe(1);
  });

  it("rewrites every cookie when multiple are set", async () => {
    const cookies = await proxyCookies([
      "a=1; Path=/; SameSite=Strict",
      "b=2; Path=/",
    ]);

    expect(cookies).toHaveLength(2);
    for (const c of cookies) {
      expect(c).toMatch(/;\s*Secure/i);
      expect(c).toMatch(/;\s*SameSite=None/i);
      expect(c).toMatch(/;\s*Partitioned/i);
    }
    expect(cookies[0]).not.toMatch(/SameSite=Strict/i);
  });
});
