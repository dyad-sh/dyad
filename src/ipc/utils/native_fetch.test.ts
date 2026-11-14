// @vitest-environment node
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { once } from "node:events";
import fetchService from "./native_fetch";
import {
  fetchUserInfo,
  UserInfoApiError,
} from "../services/user_budget_service";

let server: Server;
let base: string;
const account = {
  usedCredits: 1,
  totalCredits: 20,
  budgetResetDate: "2026-12-01",
  userId: "test-user",
};
beforeAll(async () => {
  server = createServer(async (req, res) => {
    if (req.url === "/hang") return;
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/account" });
      res.end();
      return;
    }
    if (req.url === "/upload") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      res.end(
        JSON.stringify({
          body: Buffer.concat(chunks).toString("base64"),
          type: req.headers["content-type"],
          signed: req.headers["x-goog-test"],
        }),
      );
      return;
    }
    if (req.url === "/head") {
      res.writeHead(200, { Date: "Fri, 13 Nov 2026 00:00:00 GMT" });
      res.end();
      return;
    }
    const body = gzipSync(
      JSON.stringify(req.url === "/denied" ? { error: "denied" } : account),
    );
    res.writeHead(req.url === "/denied" ? 403 : 200, {
      "Content-Encoding": "gzip",
      "Content-Type": "application/json",
      "Transfer-Encoding": "chunked",
    });
    res.write(body.subarray(0, 17));
    setImmediate(() => res.end(body.subarray(17)));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it("reads gzip/chunked account data through the production service", async () => {
  const prior = process.env.DYAD_USER_INFO_URL;
  process.env.DYAD_USER_INFO_URL = `${base}/account`;
  try {
    expect(await fetchUserInfo("synthetic-key")).toEqual({
      ...account,
      isTrial: false,
    });
  } finally {
    if (prior === undefined) delete process.env.DYAD_USER_INFO_URL;
    else process.env.DYAD_USER_INFO_URL = prior;
  }
});
it("preserves account HTTP errors and redirect rejection", async () => {
  const prior = process.env.DYAD_USER_INFO_URL;
  try {
    process.env.DYAD_USER_INFO_URL = `${base}/denied`;
    await expect(fetchUserInfo("key")).rejects.toEqual(
      new UserInfoApiError(403),
    );
    process.env.DYAD_USER_INFO_URL = `${base}/redirect`;
    await expect(fetchUserInfo("key")).rejects.toThrow();
  } finally {
    if (prior === undefined) delete process.env.DYAD_USER_INFO_URL;
    else process.env.DYAD_USER_INFO_URL = prior;
  }
});
it("sends exact signed PUT bytes and headers for strings and PNG buffers", async () => {
  for (const body of [
    '{"report":true}',
    Buffer.from([137, 80, 78, 71, 0, 255]),
  ]) {
    const response = await fetchService(`${base}/upload`, {
      method: "PUT",
      body,
      headers: { "Content-Type": "image/png", "x-goog-test": "signed" },
    });
    expect(await response.json()).toEqual({
      body: Buffer.from(body).toString("base64"),
      type: "image/png",
      signed: "signed",
    });
  }
});
it("retains HEAD Date headers", async () => {
  const response = await fetchService(`${base}/head`, { method: "HEAD" });
  expect(response.headers.get("date")).toBe("Fri, 13 Nov 2026 00:00:00 GMT");
  expect(await response.text()).toBe("");
});
it("honors caller cancellation and timeout signals", async () => {
  const controller = new AbortController();
  const request = fetchService(`${base}/hang`, { signal: controller.signal });
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
  await expect(
    fetchService(`${base}/hang`, { signal: AbortSignal.timeout(30) }),
  ).rejects.toMatchObject({ name: "TimeoutError" });
});

it("cancels unread account error streams and keeps the HTTP error if cancellation fails", async () => {
  const cancel = vi.fn().mockRejectedValue(new Error("already closed"));
  const response = new Response(new ReadableStream({ cancel }), {
    status: 403,
  });
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
  try {
    await expect(fetchUserInfo("key")).rejects.toEqual(
      new UserInfoApiError(403),
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: expect.objectContaining({ Authorization: "Bearer key" }),
      }),
    );
  } finally {
    spy.mockRestore();
  }
});
