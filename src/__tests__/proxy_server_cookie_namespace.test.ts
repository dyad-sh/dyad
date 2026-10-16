import http from "node:http";
import net from "node:net";
import path from "node:path";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { getPreviewCookieNamespace } from "../../shared/preview_hostname";

const workerPath = path.resolve(__dirname, "../../worker/proxy_server.js");

const SESSION_COOKIE = "__Secure_neon-auth.session_token";

describe("proxy worker per-app cookie namespacing", () => {
  let upstream: http.Server;
  let sockets: WebSocketServer;
  let upstreamOrigin: string;
  let receivedCookies: (string | undefined)[];
  const workers: Worker[] = [];

  beforeEach(async () => {
    receivedCookies = [];
    upstream = http.createServer((req, res) => {
      receivedCookies.push(req.headers.cookie);
      const setCookie: Record<string, string[]> = {
        "/sign-in": [
          `${SESSION_COOKIE}=token; Path=/; HttpOnly; SameSite=Lax`,
          "theme=dark; Path=/",
        ],
        "/sign-out": [`${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0`],
        "/sign-out-without-httponly": [
          `${SESSION_COOKIE}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
        ],
      };
      res.writeHead(200, {
        "content-type": "text/plain",
        "set-cookie": setCookie[req.url ?? ""] ?? [],
      });
      res.end("ok");
    });
    sockets = new WebSocketServer({ server: upstream });
    sockets.on("connection", (_ws, req) => {
      receivedCookies.push(req.headers.cookie);
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    upstreamOrigin = `http://127.0.0.1:${(upstream.address() as net.AddressInfo).port}`;
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
    sockets.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  async function startProxy(
    workerData: Record<string, unknown>,
  ): Promise<number> {
    const worker = new Worker(workerPath, {
      workerData: {
        targetOrigin: upstreamOrigin,
        hostname: "localhost",
        port: 0,
        authBootstrapToken: "capability",
        ...workerData,
      },
    });
    workers.push(worker);
    const origin = await new Promise<string>((resolve, reject) => {
      worker.on("error", reject);
      worker.on("message", (message) => {
        if (
          typeof message === "string" &&
          message.startsWith("proxy-server-start url=")
        )
          resolve(message.slice("proxy-server-start url=".length));
      });
    });
    return Number(new URL(origin).port);
  }

  function request(
    port: number,
    urlPath: string,
    cookie?: string,
  ): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const req = http.get(
        {
          host: "127.0.0.1",
          port,
          path: urlPath,
          headers: {
            Host: `localhost:${port}`,
            ...(cookie ? { Cookie: cookie } : {}),
          },
        },
        (res) => {
          res.resume();
          res.on("end", () => resolve(res.headers["set-cookie"] ?? []));
        },
      );
      req.once("error", reject);
    });
  }

  it("namespaces HttpOnly cookies and leaves script-readable cookies shared", async () => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(12),
    });

    const cookies = await request(port, "/sign-in");

    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toMatch(
      new RegExp(`^dyad-a12\\.${SESSION_COOKIE}=token;`),
    );
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toMatch(/;\s*SameSite=None/);
    expect(cookies[1]).toMatch(/^theme=dark;/);
  });

  it("keeps each app's session when two apps share the localhost cookie jar", async () => {
    const appA = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(1),
    });
    const appB = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(2),
    });
    // What the browser holds after signing into both apps, plus a stale
    // shared session cookie from before namespacing.
    const jar = [
      `${SESSION_COOKIE}=legacy`,
      `dyad-a1.${SESSION_COOKIE}=token-a`,
      `dyad-a2.${SESSION_COOKIE}=token-b`,
      "theme=dark",
    ].join("; ");

    await request(appA, "/", jar);
    await request(appB, "/", jar);

    expect(receivedCookies).toEqual([
      `${SESSION_COOKIE}=token-a; theme=dark`,
      `${SESSION_COOKIE}=token-b; theme=dark`,
    ]);
  });

  it("drops the cookie header when only other apps' cookies remain", async () => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(1),
    });

    await request(port, "/", `dyad-a2.${SESSION_COOKIE}=token-b`);

    expect(receivedCookies).toEqual([undefined]);
  });

  it("clears the legacy session as well as the namespaced session on sign-out", async () => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(12),
    });

    const cookies = await request(port, "/sign-out");

    expect(cookies.map((cookie) => cookie.split("=", 1)[0])).toEqual([
      SESSION_COOKIE,
      `dyad-a12.${SESSION_COOKIE}`,
    ]);
    for (const cookie of cookies) {
      expect(cookie).toContain("Max-Age=0");
      expect(cookie).toContain("HttpOnly");
    }
  });

  it("clears both copies when a deletion omits HttpOnly", async () => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(12),
    });

    const cookies = await request(port, "/sign-out-without-httponly");

    expect(cookies.map((cookie) => cookie.split("=", 1)[0])).toEqual([
      SESSION_COOKIE,
      `dyad-a12.${SESSION_COOKIE}`,
    ]);
  });

  it("restores namespaced cookies on WebSocket upgrades", async () => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(1),
    });

    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port,
        path: "/",
        headers: {
          Host: `localhost:${port}`,
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          Cookie: `dyad-a1.${SESSION_COOKIE}=token-a; dyad-a2.${SESSION_COOKIE}=token-b`,
        },
      });
      req.on("upgrade", (_res, socket) => {
        socket.destroy();
        resolve();
      });
      req.once("error", reject);
      req.end();
    });

    expect(receivedCookies).toEqual([`${SESSION_COOKIE}=token-a`]);
  });

  it("leaves cookies untouched without a namespace", async () => {
    const port = await startProxy({});

    const cookies = await request(
      port,
      "/sign-in",
      `dyad-a2.${SESSION_COOKIE}=token-b`,
    );

    expect(cookies[0]).toMatch(new RegExp(`^${SESSION_COOKIE}=token;`));
    expect(receivedCookies).toEqual([`dyad-a2.${SESSION_COOKIE}=token-b`]);
  });

  it("rejects a malformed namespace", async () => {
    await expect(startProxy({ cookieNamespace: "evil=" })).rejects.toThrow(
      "Invalid cookie namespace",
    );
  });
});
