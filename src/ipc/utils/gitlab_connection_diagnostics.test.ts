import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  netFetch: vi.fn(),
  nodeFetch: vi.fn(),
  info: vi.fn(),
}));
vi.mock("electron", () => ({
  app: { getVersion: () => "1.22.0-alpha.1" },
  net: { fetch: h.netFetch },
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ info: h.info }) },
}));

import { testGitLabConnection } from "./gitlab_connection_diagnostics";
import {
  GitLabConnectionDiagnosticsSchema,
  gitlabContracts,
} from "../types/gitlab";
import { formatGitLabConnectionDiagnostics } from "../../shared/gitlab_connection_diagnostics";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", h.nodeFetch);
  h.nodeFetch.mockImplementation(
    async () => new Response(null, { status: 401 }),
  );
  h.netFetch.mockImplementation(
    async () => new Response(null, { status: 401 }),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("GitLab connection diagnostics", () => {
  it("probes both stacks without credentials and preserves instance path prefixes", async () => {
    const report = await testGitLabConnection(
      "https://user:password@gitlab.internal/gitlab/?secret=hidden#fragment",
    );

    for (const request of [h.nodeFetch, h.netFetch]) {
      expect(request).toHaveBeenCalledExactlyOnceWith(
        "https://gitlab.internal/gitlab/api/v4/user",
        {
          method: "GET",
          credentials: "omit",
          redirect: "manual",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          signal: expect.any(AbortSignal),
        },
      );
    }
    expect(report).toMatchObject({
      appVersion: "1.22.0-alpha.1",
      nodeVersion: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      results: [
        { transport: "Node fetch", httpStatus: 401, error: null },
        { transport: "Electron net.fetch", httpStatus: 401, error: null },
      ],
    });
    expect(GitLabConnectionDiagnosticsSchema.parse(report)).toEqual(report);
    const text = formatGitLabConnectionDiagnostics(report);
    expect(text).toContain("Node fetch: CONNECTED — HTTP 401");
    expect(text).toContain("401 is expected without a token");
    expect(h.info).toHaveBeenCalledExactlyOnceWith(text);
    expect(text).not.toMatch(/password|hidden|fragment/);
  });

  it("reports a nested TLS failure without preventing the other probe succeeding", async () => {
    h.nodeFetch.mockRejectedValue(
      new TypeError("fetch failed", {
        cause: Object.assign(
          new Error("unable to verify the first certificate"),
          {
            code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
          },
        ),
      }),
    );
    const report = await testGitLabConnection("https://gitlab.internal");
    expect(report.results[0]).toMatchObject({
      httpStatus: null,
      error:
        "fetch failed; caused by: UNABLE_TO_VERIFY_LEAF_SIGNATURE: unable to verify the first certificate",
    });
    expect(report.results[1].httpStatus).toBe(401);
    expect(formatGitLabConnectionDiagnostics(report)).toContain(
      "Node fetch: FAILED",
    );
  });

  it("reports redirects as transport success without following them or reading bodies", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const text = vi.fn();
    h.netFetch.mockResolvedValue({ status: 302, body: { cancel }, text });
    const report = await testGitLabConnection("https://gitlab.internal");
    expect(report.results[1]).toMatchObject({ httpStatus: 302, error: null });
    expect(cancel).toHaveBeenCalledOnce();
    expect(text).not.toHaveBeenCalled();
  });

  it("times out both stacks and returns copyable results instead of throwing", async () => {
    vi.useFakeTimers();
    // Stub the timeout source too: Node's AbortSignal.timeout uses native timers.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(
        () => controller.abort(new DOMException("timeout", "TimeoutError")),
        milliseconds,
      );
      return controller.signal;
    });
    const stalled = (_url: string, { signal }: RequestInit) =>
      new Promise((_resolve, reject) => {
        signal!.addEventListener("abort", () => reject(signal!.reason));
      });
    h.nodeFetch.mockImplementation(stalled);
    h.netFetch.mockImplementation(stalled);
    const pending = testGitLabConnection("https://gitlab.internal");
    await vi.advanceTimersByTimeAsync(15_000);
    const report = await pending;
    expect(report.results.map((result) => result.error)).toEqual([
      "No response within 15s",
      "No response within 15s",
    ]);
  });

  it("rejects invalid diagnostic URLs at the IPC contract boundary", () => {
    expect(
      gitlabContracts.testConnection.input.safeParse({
        instanceUrl: "file:///secret",
      }).success,
    ).toBe(false);
    expect(
      gitlabContracts.testConnection.input.safeParse({
        instanceUrl: "https://host/" + "x".repeat(2048),
      }).success,
    ).toBe(false);
  });
});
