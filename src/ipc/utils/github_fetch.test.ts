// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createServer, get, type Server } from "node:http";
import { gunzipSync } from "node:zlib";
import fetchGitHub from "./github_fetch";
import {
  handleAccessToken,
  handleDeviceCode,
  handleDeviceFlowConfig,
} from "../../../testing/fake-llm-server/githubHandler";

let server: Server;
let base: string;
beforeEach(async () => {
  server = createServer(async (req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, {
        "Set-Cookie": "github_session=must-not-be-sent",
        Location: "/headers",
      });
      res.end();
      return;
    }
    if (req.url === "/slow") {
      res.setHeader("Content-Type", "application/json");
      res.write('{"unfinished":');
      return;
    }
    const response = Object.assign(res, {
      status(code: number) {
        res.statusCode = code;
        return response;
      },
      json(body: unknown) {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(body));
        return response;
      },
    });
    if (req.url === "/headers") {
      response.json(req.headers);
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString();
    const request = Object.assign(req, { body: text ? JSON.parse(text) : {} });
    const handler =
      req.url === "/config"
        ? handleDeviceFlowConfig
        : req.url === "/device"
          ? handleDeviceCode
          : handleAccessToken;
    handler(request as never, response as never);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  base = `http://127.0.0.1:${address.port}`;
  await fetchGitHub(`${base}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "gzip-chunked" }),
  }).then((response) => response.json());
});
afterEach(async () => {
  vi.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

it("serves actual gzip/chunked bytes and consumes device, pending and token JSON", async () => {
  await new Promise<void>((resolve, reject) => {
    const request = get(`${base}/device`, { method: "POST" }, (response) => {
      expect(response.headers["content-encoding"]).toBe("gzip");
      expect(response.headers["transfer-encoding"]).toBe("chunked");
      expect(response.headers["content-length"]).toBeUndefined();
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("error", reject);
      response.on("end", () => {
        try {
          expect(
            JSON.parse(gunzipSync(Buffer.concat(chunks)).toString()),
          ).toMatchObject({ user_code: "FAKE-CODE" });
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on("error", reject);
  });
  const device = await fetchGitHub(`${base}/device`, { method: "POST" });
  expect(await device.json()).toMatchObject({
    device_code: "fake_device_code_12345",
  });
  for (let poll = 1; poll <= 3; poll++) {
    const response = await fetchGitHub(`${base}/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ device_code: "fake_device_code_12345" }),
    });
    expect(response.status).toBe(poll < 3 ? 400 : 200);
    expect(await response.json()).toMatchObject(
      poll < 3
        ? { error: "authorization_pending" }
        : { access_token: "fake_access_token_12345" },
    );
  }
});

it("preserves same-origin redirect authorization without storing response cookies", async () => {
  const response = await fetchGitHub(`${base}/redirect`, {
    headers: { Authorization: "Bearer synthetic-token" },
  });
  expect(response.redirected).toBe(true);
  const headers = await response.json();
  expect(headers.authorization).toBe("Bearer synthetic-token");
  expect(headers.cookie).toBeUndefined();
});

it("aborts while consuming a body", async () => {
  const controller = new AbortController();
  const response = await fetchGitHub(`${base}/slow`, {
    signal: controller.signal,
  });
  const body = response.json();
  controller.abort();
  await expect(body).rejects.toMatchObject({ name: "AbortError" });
});

it("includes the DNS failure code and preserves the original fetch error", async () => {
  const error = await fetchGitHub("http://invalid.invalid").catch(
    (error: unknown) => error,
  );
  expect(error).toMatchObject({
    message: "GitHub request failed: ENOTFOUND",
    cause: {
      name: "TypeError",
      message: "fetch failed",
      cause: { code: "ENOTFOUND" },
    },
  });
});

it.each([
  [
    Object.assign(new Error("certificate verification failed"), {
      code: "CERT_HAS_EXPIRED",
    }),
    "CERT_HAS_EXPIRED",
  ],
  [
    new Error("connection closed unexpectedly"),
    "connection closed unexpectedly",
  ],
  [undefined, "fetch failed"],
])("retains actionable network diagnostics for %s", async (cause, reason) => {
  const original = new TypeError("fetch failed", { cause });
  vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(original);
  await expect(fetchGitHub(`${base}/device`)).rejects.toMatchObject({
    message: `GitHub request failed: ${reason}`,
    cause: original,
  });
});

it.each(["AbortError", "TimeoutError"])(
  "preserves %s without wrapping it",
  async (name) => {
    const reason = new DOMException("Request stopped", name);
    await expect(
      fetchGitHub(`${base}/device`, {
        signal: AbortSignal.abort(reason),
      }),
    ).rejects.toBe(reason);
  },
);
