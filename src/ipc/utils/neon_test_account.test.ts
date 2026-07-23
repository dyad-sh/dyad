import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithRetry: vi.fn(),
}));

vi.mock("@/ipc/utils/test_utils", () => ({ IS_TEST_BUILD: false }));
vi.mock("@/ipc/utils/retryWithRateLimit", () => ({
  fetchWithRetry: mocks.fetchWithRetry,
}));
vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { createNeonTestAccount } from "./neon_test_account";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchWithRetry.mockResolvedValue(new Response(null, { status: 200 }));
});

describe("createNeonTestAccount", () => {
  it("sends a trusted Origin and absolute callback URL for server-side signup", async () => {
    const account = await createNeonTestAccount({
      neonAuthBaseUrl: "https://branch-id.neonauth.example/neondb/auth/",
      appId: 42,
    });

    expect(mocks.fetchWithRetry).toHaveBeenCalledWith(
      "https://branch-id.neonauth.example/neondb/auth/sign-up/email",
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://branch-id.neonauth.example",
        },
        body: expect.any(String),
      }),
      "Create Neon test account for app 42",
    );

    const [, init] = mocks.fetchWithRetry.mock.calls[0];
    expect(JSON.parse(init.body)).toMatchObject({
      name: "Dyad Test User",
      email: account.email,
      password: account.password,
      callbackURL: "https://branch-id.neonauth.example/neondb/auth",
    });
  });

  it("surfaces Better Auth rejection details", async () => {
    mocks.fetchWithRetry.mockResolvedValue(
      new Response('{"code":"SIGNUP_DISABLED"}', { status: 400 }),
    );

    await expect(
      createNeonTestAccount({
        neonAuthBaseUrl: "https://branch-id.neonauth.example/neondb/auth",
        appId: 42,
      }),
    ).rejects.toThrow(/SIGNUP_DISABLED/);
  });
});
