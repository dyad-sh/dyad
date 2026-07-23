import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveFirstPromptDefaultChatMode } from "./provider_resume";

const mocks = vi.hoisted(() => ({
  getFreeAgentQuotaStatus: vi.fn(),
  getHomeDefaultChatMode: vi.fn(() => "build" as const),
  hasDyadProKey: vi.fn(() => false),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    freeAgentQuota: {
      getFreeAgentQuotaStatus: mocks.getFreeAgentQuotaStatus,
    },
  },
}));

vi.mock("@/lib/homeChatMode", () => ({
  getHomeDefaultChatMode: mocks.getHomeDefaultChatMode,
}));

vi.mock("@/lib/schemas", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/schemas")>()),
  hasDyadProKey: mocks.hasDyadProKey,
}));

const settings = { enableDyadPro: false } as any;
const quotaStatus = {
  messagesUsed: 0,
  messagesLimit: 5,
  isQuotaExceeded: false,
  windowStartTime: null,
  resetTime: null,
  hoursUntilReset: null,
};

describe("resolveFirstPromptDefaultChatMode", () => {
  beforeEach(() => {
    mocks.getFreeAgentQuotaStatus.mockReset();
    mocks.getHomeDefaultChatMode.mockClear();
    mocks.hasDyadProKey.mockReset();
    mocks.hasDyadProKey.mockReturnValue(false);
  });

  it("uses a resolved quota snapshot without another request", async () => {
    const queryClient = new QueryClient();

    await resolveFirstPromptDefaultChatMode({
      settings,
      envVars: {},
      quotaStatus,
      queryClient,
    });

    expect(mocks.getFreeAgentQuotaStatus).not.toHaveBeenCalled();
    expect(mocks.getHomeDefaultChatMode).toHaveBeenCalledWith(
      settings,
      {},
      true,
    );
  });

  it("waits for missing quota before choosing the effective mode", async () => {
    const queryClient = new QueryClient();
    mocks.getFreeAgentQuotaStatus.mockResolvedValue({
      ...quotaStatus,
      isQuotaExceeded: true,
    });

    await resolveFirstPromptDefaultChatMode({
      settings,
      envVars: {},
      queryClient,
    });

    expect(mocks.getHomeDefaultChatMode).toHaveBeenCalledWith(
      settings,
      {},
      false,
    );
  });

  it("deduplicates simultaneous resume lookups through the shared query", async () => {
    const queryClient = new QueryClient();
    let resolveQuota!: (value: typeof quotaStatus) => void;
    mocks.getFreeAgentQuotaStatus.mockReturnValue(
      new Promise((resolve) => {
        resolveQuota = resolve;
      }),
    );

    const first = resolveFirstPromptDefaultChatMode({
      settings,
      envVars: {},
      queryClient,
    });
    const second = resolveFirstPromptDefaultChatMode({
      settings,
      envVars: {},
      queryClient,
    });
    expect(mocks.getHomeDefaultChatMode).not.toHaveBeenCalled();
    expect(mocks.getFreeAgentQuotaStatus).toHaveBeenCalledTimes(1);

    resolveQuota(quotaStatus);
    await Promise.all([first, second]);

    expect(mocks.getHomeDefaultChatMode).toHaveBeenCalledTimes(2);
    expect(mocks.getHomeDefaultChatMode).toHaveBeenNthCalledWith(
      1,
      settings,
      {},
      true,
    );
    expect(mocks.getHomeDefaultChatMode).toHaveBeenNthCalledWith(
      2,
      settings,
      {},
      true,
    );
  });

  it("uses the safe unknown-quota fallback when lookup fails", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mocks.getFreeAgentQuotaStatus.mockRejectedValue(new Error("offline"));

    await resolveFirstPromptDefaultChatMode({
      settings,
      envVars: {},
      queryClient,
    });

    expect(mocks.getHomeDefaultChatMode).toHaveBeenCalledWith(
      settings,
      {},
      undefined,
    );
  });

  it("does not fetch free quota for Dyad Pro", async () => {
    const queryClient = new QueryClient();
    mocks.hasDyadProKey.mockReturnValue(true);

    await resolveFirstPromptDefaultChatMode({
      settings,
      envVars: {},
      queryClient,
    });

    expect(mocks.getFreeAgentQuotaStatus).not.toHaveBeenCalled();
  });
});
