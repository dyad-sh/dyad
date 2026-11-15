// @vitest-environment node
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { gzipSync } from "node:zlib";
const fixture = vi.hoisted(() => ({
  base: "",
  status: 200,
  body: "",
  authorization: "",
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    enableDyadPro: true,
    providerSettings: { auto: { apiKey: { value: "synthetic-key" } } },
  }),
}));
vi.mock("./base", () => ({ createTypedHandler: vi.fn() }));
vi.mock("../utils/dyad_engine_url", () => ({
  getDyadEngineBaseUrl: () => fixture.base,
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn() }) },
}));
import { getFreeModelQuotaStatus } from "./free_model_quota_handlers";
import { DyadErrorKind } from "@/errors/dyad_error";
let server: Server;
beforeAll(async () => {
  server = createServer((req, res) => {
    fixture.authorization = req.headers.authorization ?? "";
    const body = gzipSync(fixture.body);
    res.writeHead(fixture.status, {
      "Content-Encoding": "gzip",
      "Transfer-Encoding": "chunked",
    });
    res.write(body.subarray(0, 17));
    setImmediate(() => res.end(body.subarray(17)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  fixture.base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
beforeEach(() => {
  fixture.status = 200;
  fixture.body = JSON.stringify({
    used: 3,
    limit: 10,
    remaining: 7,
    resetAt: "2026-12-01T00:00:00Z",
  });
});
it("reads compressed quota JSON with bearer authentication", async () => {
  expect(await getFreeModelQuotaStatus()).toMatchObject({
    messagesUsed: 3,
    messagesRemaining: 7,
    isQuotaExceeded: false,
  });
  expect(fixture.authorization).toBe("Bearer synthetic-key");
});
it.each([401, 403, 500])(
  "retains error classification for compressed HTTP %s",
  async (status) => {
    fixture.status = status;
    fixture.body = "upstream error";
    await expect(getFreeModelQuotaStatus()).rejects.toMatchObject({
      kind: status === 500 ? DyadErrorKind.External : DyadErrorKind.Auth,
    });
  },
);
it("continues rejecting malformed quota responses", async () => {
  fixture.body = '{"remaining":"invalid"}';
  await expect(getFreeModelQuotaStatus()).rejects.toThrow();
});
