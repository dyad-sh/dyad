// @vitest-environment node
import { EventEmitter } from "node:events";
import http from "node:http";
import { transform } from "esbuild";
import {
  request,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildTestSignInRetrySource } from "./test_sign_in_retry";

type Retry = {
  run: (
    send: (timeout: number) => Promise<APIResponse>,
    timeout?: number,
  ) => Promise<APIResponse>;
  cancel: () => void;
};
let runtime: {
  createSignInRetry: (info: { timeout: number }) => Retry;
  signInRetryDelay: (
    headers: Record<string, string>,
    attempt: number,
  ) => number;
  installSignInApiRetry: (
    api: APIRequestContext,
    base: string,
    info: { timeout: number },
  ) => () => void;
  installSignInContextRetry: (
    context: unknown,
    base: string,
    info: { timeout: number },
  ) => Promise<() => Promise<void>>;
};

beforeAll(async () => {
  const { code } = await transform(buildTestSignInRetrySource(), {
    loader: "ts",
    target: "node20",
  });
  runtime = new Function(
    code +
      "; return { createSignInRetry, signInRetryDelay, installSignInApiRetry, installSignInContextRetry };",
  )();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function response(status: number, headers: Record<string, string> = {}) {
  return {
    status: () => status,
    headers: () => headers,
    dispose: vi.fn(async () => {}),
  } as unknown as APIResponse;
}

describe("generated sign-in retries", () => {
  it.each(["retry-after", "x-retry-after"])(
    "honors %s plus jitter and releases rejected responses",
    async (header) => {
      vi.useFakeTimers();
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const limited = response(429, { [header]: "2" });
      const success = response(200);
      const send = vi
        .fn()
        .mockResolvedValueOnce(limited)
        .mockResolvedValueOnce(success);
      const pending = runtime.createSignInRetry({ timeout: 10_000 }).run(send);
      await vi.advanceTimersByTimeAsync(2299);
      expect(send).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toBe(success);
      expect(limited.dispose).toHaveBeenCalledOnce();
      expect(send.mock.calls[1][0]).toBe(7700);
    },
  );

  it("accepts HTTP dates and falls back from an invalid standard header to X-Retry-After", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(
      runtime.signInRetryDelay(
        { "retry-after": "Thu, 01 Jan 2026 00:00:05 GMT" },
        0,
      ),
    ).toBe(5100);
    expect(
      runtime.signInRetryDelay(
        { "retry-after": "invalid", "x-retry-after": "3" },
        0,
      ),
    ).toBe(3100);
    expect(runtime.signInRetryDelay({ "retry-after": "-1" }, 0)).toBe(1100);
  });

  it("backs off exponentially without usable headers and stops after four retries", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    const limited = response(429);
    const send = vi.fn().mockResolvedValue(limited);
    const pending = runtime.createSignInRetry({ timeout: 60_000 }).run(send);
    for (const delay of [1100, 2100, 4100, 8100]) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(await pending).toBe(limited);
    expect(send).toHaveBeenCalledTimes(5);
    expect(limited.dispose).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([400, 401, 403, 500, 503])(
    "does not retry HTTP %s",
    async (status) => {
      const rejected = response(status);
      const send = vi.fn().mockResolvedValue(rejected);
      expect(await runtime.createSignInRetry({ timeout: 1000 }).run(send)).toBe(
        rejected,
      );
      expect(send).toHaveBeenCalledOnce();
    },
  );

  it("does not retry network failures", async () => {
    const send = vi.fn().mockRejectedValue(new Error("connection lost"));
    await expect(
      runtime.createSignInRetry({ timeout: 1000 }).run(send),
    ).rejects.toThrow("connection lost");
    expect(send).toHaveBeenCalledOnce();
  });

  it("leaves other origins, endpoints, and methods untouched", async () => {
    const fetch = vi.fn().mockResolvedValue(response(429));
    const api = { fetch } as unknown as APIRequestContext;
    const restore = runtime.installSignInApiRetry(
      api,
      "http://localhost:3000",
      { timeout: 5000 },
    );
    try {
      const options = { method: "POST", timeout: 500 };
      await api.fetch("https://other.example/api/auth/sign-in/email", options);
      await api.fetch("/api/auth/sign-up/email", options);
      await api.fetch("/api/auth/sign-in/email", { method: "GET" });
      expect(fetch.mock.calls).toEqual([
        ["https://other.example/api/auth/sign-in/email", options],
        ["/api/auth/sign-up/email", options],
        ["/api/auth/sign-in/email", { method: "GET" }],
      ]);
    } finally {
      restore();
    }
  });

  it("preserves failOnStatusCode for a rejected sign-in without retrying it", async () => {
    const denied = response(401);
    const fetch = vi.fn().mockResolvedValue(denied);
    const api = { fetch } as unknown as APIRequestContext;
    const restore = runtime.installSignInApiRetry(
      api,
      "http://localhost:3000",
      { timeout: 5000 },
    );
    try {
      await expect(
        api.fetch("/api/auth/sign-in/email", {
          method: "POST",
          failOnStatusCode: true,
        }),
      ).rejects.toThrow("Sign-in failed (401)");
      expect(fetch).toHaveBeenCalledOnce();
      expect(denied.dispose).toHaveBeenCalledOnce();
    } finally {
      restore();
    }
  });

  it("returns 429 when its cooldown exceeds the request budget instead of retrying early", async () => {
    vi.useFakeTimers();
    const limited = response(429, { "retry-after": "60" });
    const send = vi.fn().mockResolvedValue(limited);
    expect(
      await runtime.createSignInRetry({ timeout: 30_000 }).run(send, 500),
    ).toBe(limited);
    expect(send).toHaveBeenCalledExactlyOnceWith(500);
    expect(limited.dispose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a pending cooldown on teardown and sends no further requests", async () => {
    vi.useFakeTimers();
    const send = vi
      .fn()
      .mockResolvedValue(response(429, { "retry-after": "10" }));
    const retry = runtime.createSignInRetry({ timeout: 30_000 });
    const pending = retry.run(send);
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1);
    retry.cancel();
    await rejected;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(send).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry a response that arrives after cancellation", async () => {
    let resolve!: (response: APIResponse) => void;
    const send = vi.fn(
      () =>
        new Promise<APIResponse>((done) => {
          resolve = done;
        }),
    );
    const retry = runtime.createSignInRetry({ timeout: 1000 });
    const pending = retry.run(send);
    retry.cancel();
    const limited = response(429);
    resolve(limited);
    await expect(pending).rejects.toThrow();
    expect(limited.dispose).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });

  it("retries real Playwright post calls, preserves cookies, and leaves other endpoints alone", async () => {
    const calls: string[] = [];
    const bodies: string[] = [];
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      calls.push(req.url!);
      bodies.push(Buffer.concat(chunks).toString());
      if (req.url === "/api/auth/sign-in/email" && calls.length === 2) {
        res.writeHead(200, {
          "set-cookie": "session=test-session; Path=/; HttpOnly",
        });
        res.end("signed in");
      } else if (req.url === "/session") {
        res.end(req.headers.cookie);
      } else {
        res.writeHead(429, { "x-retry-after": "0" });
        res.end("limited");
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as import("node:net").AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const api = await request.newContext({ baseURL: base });
    const original = api.fetch;
    const restore = runtime.installSignInApiRetry(api, base, { timeout: 5000 });
    try {
      const signedIn = await api.post("/api/auth/sign-in/email", {
        data: { email: "test@dyad.test", password: "test" },
        failOnStatusCode: true,
      });
      expect(signedIn.status()).toBe(200);
      expect(bodies[0]).toBe(bodies[1]);
      expect(await (await api.get("/session")).text()).toBe(
        "session=test-session",
      );
      expect((await api.post("/api/auth/sign-up/email")).status()).toBe(429);
      expect(calls).toHaveLength(4);
    } finally {
      restore();
      expect(api.fetch).toBe(original);
      await api.dispose();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("retries browser sign-ins and removes routing on teardown", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
    let handler!: (route: unknown) => Promise<void>;
    const context = Object.assign(new EventEmitter(), {
      request: { fetch: vi.fn() },
      route: vi.fn(async (_matches, callback) => {
        handler = callback;
      }),
      unroute: vi.fn(async () => {}),
    });
    const restore = await runtime.installSignInContextRetry(
      context,
      "http://localhost:3000",
      { timeout: 5000 },
    );
    const success = response(200, { "set-cookie": "session=test" });
    const route = {
      request: () => ({ method: () => "POST" }),
      fetch: vi
        .fn()
        .mockResolvedValueOnce(response(429, { "retry-after": "0" }))
        .mockResolvedValueOnce(success),
      fulfill: vi.fn(async () => {}),
      abort: vi.fn(async () => {}),
    };
    const pending = handler(route);
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(route.fetch).toHaveBeenCalledTimes(2);
    expect(route.fulfill).toHaveBeenCalledWith({ response: success });
    await restore();
    expect(context.unroute).toHaveBeenCalledOnce();
    expect(context.listenerCount("close")).toBe(0);
  });

  it("aborts browser retry waits when the test tears down", async () => {
    vi.useFakeTimers();
    let handler!: (route: unknown) => Promise<void>;
    const context = Object.assign(new EventEmitter(), {
      request: { fetch: vi.fn() },
      route: vi.fn(async (_matches, callback) => {
        handler = callback;
      }),
      unroute: vi.fn(async () => {}),
    });
    const restore = await runtime.installSignInContextRetry(
      context,
      "http://localhost:3000",
      { timeout: 30_000 },
    );
    const route = {
      request: () => ({ method: () => "POST" }),
      fetch: vi.fn().mockResolvedValue(response(429, { "retry-after": "10" })),
      fulfill: vi.fn(),
      abort: vi.fn(async () => {}),
    };
    const pending = handler(route);
    await vi.advanceTimersByTimeAsync(1);
    await restore();
    await pending;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(route.fetch).toHaveBeenCalledOnce();
    expect(route.abort).toHaveBeenCalledWith("aborted");
    expect(route.fulfill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts paused browser requests before unroute can forward them during teardown", async () => {
    let handler!: (route: unknown) => Promise<void>;
    let finishFetch!: (response: APIResponse) => void;
    let finishAbort!: () => void;
    const events: string[] = [];
    const context = Object.assign(new EventEmitter(), {
      request: { fetch: vi.fn() },
      route: vi.fn(async (_matches, callback) => {
        handler = callback;
      }),
      unroute: vi.fn(async () => {
        events.push("unroute");
      }),
    });
    const restore = await runtime.installSignInContextRetry(
      context,
      "http://localhost:3000",
      { timeout: 30_000 },
    );
    const route = {
      request: () => ({ method: () => "POST" }),
      fetch: vi.fn(
        () =>
          new Promise<APIResponse>((resolve) => {
            finishFetch = resolve;
          }),
      ),
      fulfill: vi.fn(),
      abort: vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finishAbort = () => {
                events.push("aborted");
                resolve();
              };
            }),
        )
        .mockResolvedValue(undefined),
    };
    const pending = handler(route);
    const cleanup = restore();
    expect(context.unroute).not.toHaveBeenCalled();
    finishAbort();
    await cleanup;
    expect(events).toEqual(["aborted", "unroute"]);
    finishFetch(response(429));
    await pending;
    expect(route.fetch).toHaveBeenCalledOnce();
    expect(route.fulfill).not.toHaveBeenCalled();
  });
});
