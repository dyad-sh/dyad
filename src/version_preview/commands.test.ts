import { QueryClient } from "@tanstack/react-query";
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import type { App } from "@/ipc/types";
import { createVersionPreviewRuntime } from "./commands";

const { checkoutVersionMock, getAppMock, restartAppWithStoreMock } = vi.hoisted(
  () => ({
    checkoutVersionMock: vi.fn(),
    getAppMock: vi.fn(),
    restartAppWithStoreMock: vi.fn(),
  }),
);

vi.mock("@/ipc/types", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/types")>()),
  ipc: {
    app: { getApp: getAppMock },
    version: { checkoutVersion: checkoutVersionMock },
  },
}));

vi.mock("@/hooks/useRunApp", () => ({
  restartAppWithStore: restartAppWithStoreMock,
}));

vi.mock("@/lib/toast", () => ({ showError: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn() },
}));

describe("createVersionPreviewRuntime", () => {
  beforeEach(() => {
    checkoutVersionMock.mockReset();
    getAppMock.mockReset();
    restartAppWithStoreMock.mockReset();
    checkoutVersionMock.mockResolvedValue(undefined);
    restartAppWithStoreMock.mockResolvedValue(undefined);
  });

  it("fetches uncached app details before deciding whether to restart Neon", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const store = createStore();
    const appId = 7;
    const app = { id: appId, neonProjectId: "neon-project" } as App;
    getAppMock.mockResolvedValue(app);
    expect(
      queryClient.getQueryData(queryKeys.apps.detail({ appId })),
    ).toBeUndefined();

    const runtime = createVersionPreviewRuntime({ queryClient, store });
    await runtime.commands.returnToBranch({ appId, branch: "main" });

    expect(getAppMock).toHaveBeenCalledWith(appId);
    expect(restartAppWithStoreMock).toHaveBeenCalledWith(store, appId);
  });
});
