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
        "/sign-out-with-value": [
          `${SESSION_COOKIE}=stale; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT`,
        ],
        "/max-age-overrides-expires": [
          `${SESSION_COOKIE}=token; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=3600`,
        ],
        "/invalid-max-age": [
          `${SESSION_COOKIE}=token; Path=/; HttpOnly; Max-Age=`,
        ],
        "/sign-out-cookie-date": [
          `${SESSION_COOKIE}=; Path=/; HttpOnly; Expires=Wed@09@Jun@2021@10:18:14@GMT`,
        ],
        "/sign-out-invalid-later-expires": [
          `${SESSION_COOKIE}=; Path=/; HttpOnly; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Expires=never`,
        ],
        "/impossible-expires": [
          `${SESSION_COOKIE}=token; Path=/; HttpOnly; Expires=Sat, 31 Feb 1970 00:00:00 GMT`,
        ],
        "/valued-httponly": [`${SESSION_COOKIE}=token; Path=/; HttpOnly=false`],
        "/script-readable-session": [`${SESSION_COOKIE}=token; Path=/`],
        "/security-prefixes": [
          "__Host-",
          "__Secure-",
          "__Http-",
          "__Host-Http-",
          "__host-",
        ].map((prefix) => `${prefix}session=token; Path=/; HttpOnly; Secure`),
        "/host-sign-out": [
          "__Host-session=; Path=/; HttpOnly; Secure; Max-Age=0",
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

    expect(cookies).toHaveLength(3);
    expect(cookies[0]).toMatch(
      new RegExp(`^dyad-a12\\.${SESSION_COOKIE}=token;`),
    );
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[0]).toMatch(/;\s*SameSite=None/);
    expect(cookies[1]).toMatch(/^dyad-a12\.theme=;.*Max-Age=0/);
    expect(cookies[2]).toMatch(/^theme=dark;/);
  });

  it("retires the namespaced copy when a cookie becomes script-readable", async () => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(12),
    });

    const [deletion, shared] = await request(port, "/script-readable-session");

    expect(deletion).toMatch(new RegExp(`^dyad-a12\\.${SESSION_COOKIE}=;`));
    expect(deletion).toContain("Path=/");
    expect(deletion).toContain("Max-Age=0");
    expect(shared).toMatch(new RegExp(`^${SESSION_COOKIE}=token;`));
  });

  it("accepts a shared-localhost Cookie header beyond Node's 16 KiB default", async () => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(1),
    });
    const siblingSessions = Array.from(
      { length: 40 },
      (_, i) => `dyad-a${i + 2}.${SESSION_COOKIE}=${"x".repeat(1000)}`,
    );

    await request(
      port,
      "/",
      [`dyad-a1.${SESSION_COOKIE}=token-a`, ...siblingSessions].join("; "),
    );

    expect(receivedCookies).toEqual([`${SESSION_COOKIE}=token-a`]);
  });

  it("keeps security prefixes first on writes and restores them on requests", async () => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(12),
    });
    const prefixes = [
      "__Host-",
      "__Secure-",
      "__Http-",
      "__Host-Http-",
      "__host-",
    ];
    const cookies = await request(port, "/security-prefixes");
    expect(cookies.map((cookie) => cookie.split(";", 1)[0])).toEqual(
      prefixes.map((prefix) => `${prefix}dyad-a12.session=token`),
    );
    await request(
      port,
      "/",
      [
        ...cookies.map((cookie) => cookie.split(";", 1)[0]),
        "__Host-dyad-a13.session=sibling",
        "__Host-session=shared",
        "theme=dark",
      ].join("; "),
    );
    expect(receivedCookies.at(-1)).toBe(
      [
        ...prefixes.map((prefix) => `${prefix}session=token`),
        "theme=dark",
      ].join("; "),
    );
    const deletions = await request(port, "/host-sign-out");
    expect(deletions.map((cookie) => cookie.split(";", 1)[0])).toEqual([
      "__Host-session=",
      "__Host-dyad-a12.session=",
    ]);
  });

  it("does not restore legacy security-prefixed cookies that scripts could shadow", async () => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(12),
    });
    await request(
      port,
      "/",
      "dyad-a12.__Host-session=shadow; dyad-a12.__Secure-session=shadow; theme=dark",
    );
    expect(receivedCookies).toEqual(["theme=dark"]);
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

  it("forwards every same-name namespaced cookie, as the browser would", async () => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(1),
    });

    await request(port, "/", "dyad-a1.sid=api; dyad-a1.sid=root; sid=legacy");

    expect(receivedCookies).toEqual(["sid=api; sid=root"]);
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

  it.each([
    ["omits HttpOnly", "/sign-out-without-httponly"],
    ["uses an RFC 6265 cookie-date", "/sign-out-cookie-date"],
    ["ends with an unparseable Expires", "/sign-out-invalid-later-expires"],
  ])("clears both copies when a deletion %s", async (_case, urlPath) => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(12),
    });

    const cookies = await request(port, urlPath);

    expect(cookies.map((cookie) => cookie.split("=", 1)[0])).toEqual([
      SESSION_COOKIE,
      `dyad-a12.${SESSION_COOKIE}`,
    ]);
  });

  it("never stores a live value under the shared name when clearing it", async () => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(12),
    });

    const [legacy, namespaced] = await request(port, "/sign-out-with-value");

    expect(legacy).toMatch(new RegExp(`^${SESSION_COOKIE}=;`));
    expect(legacy).toContain("Max-Age=0");
    expect(legacy).not.toMatch(/Expires=/i);
    expect(namespaced).toMatch(
      new RegExp(`^dyad-a12\\.${SESSION_COOKIE}=stale;`),
    );
  });

  it.each([
    [
      "a positive Max-Age overrides a past Expires",
      "/max-age-overrides-expires",
    ],
    ["an empty Max-Age is ignored", "/invalid-max-age"],
    ["an impossible Expires date is ignored", "/impossible-expires"],
    ["its HttpOnly attribute has a value", "/valued-httponly"],
  ])("namespaces a live HttpOnly cookie when %s", async (_case, urlPath) => {
    const port = await startProxy({
      cookieNamespace: getPreviewCookieNamespace(12),
    });

    const cookies = await request(port, urlPath);

    expect(cookies.map((cookie) => cookie.split("=", 1)[0])).toEqual([
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
