// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { Response as NodeResponse } from "node-fetch";
const mocks = vi.hoisted(() => ({
  accountFetch: vi.fn(),
  key: "test-billing-key",
  warn: vi.fn(),
}));
vi.mock("node-fetch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node-fetch")>()),
  default: mocks.accountFetch,
}));
vi.mock("@/main/settings", () => ({
  readSettings: () => ({
    providerSettings: { auto: { apiKey: { value: mocks.key } } },
  }),
}));
vi.mock("../services/codex_subscription_auth", () => ({
  getCodexSubscriptionCredentials: async () => ({
    access: "test-access",
    accountId: "test-account",
  }),
}));
vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: mocks.warn }) },
}));
import { createCodexSubscriptionModel } from "./codex_subscription_provider";
import { DyadErrorKind } from "@/errors/dyad_error";

const info = {
  totalCredits: 100,
  usedCredits: 10,
  budgetResetDate: "2026-10-01",
  userId: "test-user",
};
const accountResponse = (body = info) =>
  new NodeResponse(JSON.stringify(body), { status: 200 });
async function run(signal?: AbortSignal) {
  const model = await createCodexSubscriptionModel("gpt-5.6-luna");
  const result = await model.doStream({ prompt: [], abortSignal: signal });
  // No inference completion in this fixture: cancel to dispose active context.
  await result.stream.cancel();
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.key = "test-billing-key";
  mocks.accountFetch.mockImplementation(async () => accountResponse());
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("", { headers: { "Content-Type": "text/event-stream" } }),
    ),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("BYO subscription preflight through the actual provider", () => {
  it("checks a fresh account balance before every inference request", async () => {
    await run();
    await run();
    expect(mocks.accountFetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(mocks.accountFetch.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(fetch).mock.invocationCallOrder[0],
    );
    expect(mocks.accountFetch).toHaveBeenCalledWith(
      "https://api.dyad.sh/v1/user/info",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        headers: expect.objectContaining({
          Authorization: "Bearer test-billing-key",
          "Cache-Control": "no-cache",
        }),
      }),
    );
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(
          ([url]) => url === "https://chatgpt.com/backend-api/codex/responses",
        ),
    ).toBe(true);
  });
  it.each([100, 101])(
    "blocks exhausted balance (%i used) even on HTTP 200",
    async (usedCredits) => {
      mocks.accountFetch.mockResolvedValue(
        accountResponse({ ...info, usedCredits }),
      );
      await expect(run()).rejects.toMatchObject({
        kind: DyadErrorKind.Precondition,
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([401, 403, 402])(
    "blocks a confirmed HTTP %i rejection without inference",
    async (status) => {
      mocks.accountFetch.mockResolvedValue(
        new NodeResponse("untrusted upstream detail", { status }),
      );
      await expect(run()).rejects.toMatchObject({
        kind: status === 402 ? DyadErrorKind.Precondition : DyadErrorKind.Auth,
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each([429, 500, 502, 503])(
    "allows generation if the account API returns %i",
    async (status) => {
      mocks.accountFetch.mockResolvedValue(
        new NodeResponse("untrusted upstream detail", { status }),
      );
      await run();
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(mocks.accountFetch).toHaveBeenCalledTimes(1);
    },
  );
  it("allows generation after a network failure, without leaking the error", async () => {
    mocks.accountFetch.mockRejectedValue(new Error("sensitive-network-detail"));
    await run();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain(
      "sensitive-network-detail",
    );
  });
  it("bounds the credit check to five seconds and fails open on timeout", async () => {
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(
        AbortSignal.abort(new DOMException("Timeout", "TimeoutError")),
      );
    mocks.accountFetch.mockImplementation(async (_url, options) => {
      options.signal.throwIfAborted();
      return accountResponse();
    });
    await run();
    expect(timeout).toHaveBeenCalledWith(5_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not interpret malformed API responses as exhausted credits", async () => {
    mocks.accountFetch.mockResolvedValue(
      new NodeResponse('{"totalCredits":null}', { status: 200 }),
    );
    await run();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("honors user cancellation rather than treating it as a service outage", async () => {
    await expect(run(AbortSignal.abort())).rejects.toMatchObject({
      kind: DyadErrorKind.UserCancelled,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.accountFetch).not.toHaveBeenCalled();
  });
  it("does not bypass checks in test builds and supports the existing fixture URL", async () => {
    vi.stubEnv("E2E_TEST_BUILD", "true");
    vi.stubEnv("DYAD_USER_INFO_URL", "http://127.0.0.1:1234/account");
    mocks.accountFetch.mockResolvedValue(
      accountResponse({ ...info, usedCredits: 100 }),
    );
    await expect(run()).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
    });
    expect(mocks.accountFetch.mock.calls[0][0]).toBe(
      "http://127.0.0.1:1234/account",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});
