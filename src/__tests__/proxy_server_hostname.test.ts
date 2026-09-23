import http from "node:http";
import net from "node:net";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket, WebSocketServer } from "ws";

const workerPath = path.resolve(__dirname, "../../worker/proxy_server.js");

describe("app preview authority and forwarding", () => {
  let upstream: http.Server;
  let worker: Worker;
  let sockets: WebSocketServer;
  let origin: string;
  let upstreamOrigin: string;
  let port: number;
  let requests: http.IncomingMessage[];

  beforeEach(async () => {
    requests = [];
    upstream = http.createServer((req, res) => {
      requests.push(req);
      if (req.url?.startsWith("/redirect")) {
        const destination = new URL(req.url, upstreamOrigin).searchParams.get(
          "to",
        )!;
        res.writeHead(302, { location: destination });
        res.end();
      } else if (req.url === "/cookie") {
        res.writeHead(200, {
          "set-cookie": [
            "session=42; Domain=localhost; Path=/; HttpOnly; SameSite=Lax",
            "expired=; dOmAiN = .localhost; Max-Age=0; Path=/auth; HttpOnly",
          ],
        });
        res.end("cookies");
      } else {
        res.setHeader("content-type", "application/json");
        const body: Buffer[] = [];
        req.on("data", (data) => body.push(data));
        req.on("end", () =>
          res.end(
            JSON.stringify({
              url: req.url,
              method: req.method,
              headers: req.headers,
              body: Buffer.concat(body).toString(),
            }),
          ),
        );
      }
    });
    sockets = new WebSocketServer({ server: upstream });
    sockets.on("connection", (ws, req) => {
      requests.push(req);
      ws.on("message", (data) => ws.send(data));
    });
    upstream.listen(0, "127.0.0.1");
    await once(upstream, "listening");
    upstreamOrigin = `http://127.0.0.1:${(upstream.address() as net.AddressInfo).port}`;
    worker = new Worker(workerPath, {
      workerData: {
        targetOrigin: upstreamOrigin,
        hostname: "app-42.localhost",
        port: 0,
        authBootstrapToken: "capability",
      },
    });
    origin = await new Promise<string>((resolve, reject) => {
      worker.on("error", reject);
      worker.on("message", (message) => {
        if (
          typeof message === "string" &&
          message.startsWith("proxy-server-start url=")
        )
          resolve(message.slice("proxy-server-start url=".length));
      });
    });
    port = Number(new URL(origin).port);
  });

  afterEach(async () => {
    for (const client of sockets?.clients ?? []) client.terminate();
    await worker?.terminate();
    sockets?.close();
    if (upstream)
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
  });

  function request(
    requestPath: string,
    headers: Record<string, string> = {},
    body?: string,
  ) {
    return new Promise<{
      status: number;
      headers: http.IncomingHttpHeaders;
      body: string;
    }>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: requestPath,
          method: body ? "POST" : "GET",
          headers: { Host: `app-42.localhost:${port}`, ...headers },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode!,
              headers: res.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  }

  it("advertises its hostname and bound port and forwards HTTP with upstream headers", async () => {
    expect(origin).toBe(`http://app-42.localhost:${port}`);
    const result = await request(
      "/api?q=1",
      {
        Origin: origin,
        Referer: `${origin}/login?return=1`,
        "Content-Type": "text/plain",
      },
      "payload",
    );
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({
      url: "/api?q=1",
      method: "POST",
      body: "payload",
      headers: {
        host: new URL(upstreamOrigin).host,
        origin: upstreamOrigin,
        referer: `${upstreamOrigin}/login?return=1`,
      },
    });
  });

  it.each([
    "app-43.localhost",
    "localhost",
    "app-42.localhost.evil",
    "app-42.localhost.",
    "nested.app-42.localhost",
  ])(
    "rejects sibling/deceptive hostname %s before HTTP or injected resources",
    async (hostname) => {
      for (const pathname of ["/api", "/dyad-sw.js"]) {
        expect(
          (await request(pathname, { Host: `${hostname}:${port}` })).status,
        ).toBe(421);
      }
      expect(requests).toHaveLength(0);
    },
  );

  it("rejects another port, a missing port, and an absolute URL with another authority", async () => {
    expect(
      (await request("/", { Host: `app-42.localhost:${port + 1}` })).status,
    ).toBe(421);
    expect((await request("/", { Host: "app-42.localhost" })).status).toBe(421);
    expect((await request("http://app-43.localhost:42143/api")).status).toBe(
      421,
    );
    expect(requests).toHaveLength(0);
  });

  it("rewrites only redirects to the configured upstream, preserving URL components", async () => {
    for (const destination of [
      `${upstreamOrigin}/callback?q=1#hash`,
      `//${new URL(upstreamOrigin).host}/callback?q=1#hash`,
    ]) {
      expect(
        (await request(`/redirect?to=${encodeURIComponent(destination)}`))
          .headers.location,
      ).toBe(`${origin}/callback?q=1#hash`);
    }
    for (const destination of [
      "https://neon.com/callback?q=1#hash",
      "/relative?q=1#hash",
    ]) {
      expect(
        (await request(`/redirect?to=${encodeURIComponent(destination)}`))
          .headers.location,
      ).toBe(destination);
    }
  });

  it("makes creation and deletion cookies host-only while retaining iframe compatibility", async () => {
    const cookies = (await request("/cookie")).headers["set-cookie"]!;
    expect(cookies).toEqual([
      "session=42; Path=/; HttpOnly; Secure; SameSite=None",
      "expired=; Max-Age=0; Path=/auth; HttpOnly; Secure; SameSite=None",
    ]);
  });

  it("forwards WebSocket messages and rewrites the upstream authority and origin", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/hot?q=1`, {
      headers: { Host: `app-42.localhost:${port}`, Origin: origin },
    });
    try {
      await once(ws, "open");
      ws.send("hot reload");
      const [data] = await once(ws, "message");
      expect(data.toString()).toBe("hot reload");
      expect(requests[0].headers).toMatchObject({
        host: new URL(upstreamOrigin).host,
        origin: upstreamOrigin,
      });
      expect(requests[0].url).toBe("/hot?q=1");
    } finally {
      ws.terminate();
    }
  });

  it("keeps WebSocket upgrade cookies host-only as separate headers", async () => {
    sockets.once("headers", (headers) => {
      headers.push(
        "Set-Cookie: session=42; Domain=localhost; Path=/; HttpOnly",
      );
      headers.push(
        "Set-Cookie: expired=; Domain=.localhost; Max-Age=0; Path=/",
      );
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/hot`, {
      headers: { Host: `app-42.localhost:${port}` },
    });
    try {
      const [response] = await once(ws, "upgrade");
      expect(response.headers["set-cookie"]).toEqual([
        "session=42; Path=/; HttpOnly; Secure; SameSite=None",
        "expired=; Max-Age=0; Path=/; Secure; SameSite=None",
      ]);
    } finally {
      ws.on("error", () => {});
      ws.terminate();
    }
  });

  it("keeps serving HTTP after an upstream WebSocket reset", async () => {
    sockets.once("connection", (connection) => {
      (
        connection as unknown as { _socket: net.Socket }
      )._socket.resetAndDestroy();
    });
    const ws = new WebSocket(`ws://127.0.0.1:${port}/hot`, {
      headers: { Host: `app-42.localhost:${port}` },
    });
    ws.on("error", () => {});
    await new Promise<void>((resolve) => ws.once("close", () => resolve()));
    expect((await request("/still-alive")).status).toBe(200);
  });

  it("rejects WebSocket upgrades from another app before contacting upstream", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/hot`, {
      headers: { Host: `app-43.localhost:${port}` },
    });
    await expect(once(ws, "open")).rejects.toThrow("421");
    expect(requests).toHaveLength(0);
  });

  it.each([
    "https://attacker.example",
    "http://app-43.localhost:42143",
    "null",
  ])(
    "rejects credentialed WebSockets from foreign Origin %s",
    async (foreignOrigin) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/hot`, {
        headers: {
          Host: `app-42.localhost:${port}`,
          Origin: foreignOrigin,
          Cookie: "session=42",
        },
      });
      await expect(once(ws, "open")).rejects.toThrow("403");
      expect(requests).toHaveLength(0);
    },
  );
});
