import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findApp: vi.fn(),
  readEnv: vi.fn(),
}));
vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: mocks.findApp } } },
}));
vi.mock("@/paths/paths", () => ({ getDyadAppPath: (path: string) => path }));
vi.mock("../utils/app_env_var_utils", () => ({
  readEnvVarsOrEmpty: mocks.readEnv,
}));
vi.mock("../utils/neon_utils", () => ({
  ensureNeonAuthTrustedDomain: vi.fn(),
}));

import {
  NeonPreviewDomainService,
  resolveNeonPreviewTarget,
} from "./neon_preview_domain_service";

function input(branchId = "br-active") {
  return {
    appId: 42,
    processId: 1,
    invocationRef: {
      kind: "app-run",
      entityKey: 42,
      operationId: "run:1",
    } as const,
    target: { projectId: "project", branchId },
    origin: "http://app-42.localhost:42999",
    signal: new AbortController().signal,
  };
}

describe("Neon preview domain registration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deduplicates concurrent registration for the actual bound origin", async () => {
    let done!: () => void;
    const register = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          done = () => resolve(null);
        }),
    );
    const service = new NeonPreviewDomainService(register);
    const first = service.ensure(input());
    const second = service.ensure(input());
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith({
      projectId: "project",
      branchId: "br-active",
      origin: "http://app-42.localhost:42999",
      signal: expect.any(AbortSignal),
    });
    done();
    await Promise.all([first, second]);
  });

  it("reconciles changed branches, invocations, and restarts", async () => {
    const register = vi.fn().mockResolvedValue(null);
    const service = new NeonPreviewDomainService(register);
    await service.ensure(input());
    await service.ensure(input("br-temporary"));
    await service.ensure({ ...input(), processId: 2 });
    await service.ensure(input());
    expect(register).toHaveBeenCalledTimes(4);
    expect(register.mock.calls[1][0].branchId).toBe("br-temporary");
  });

  it("bounds registration, aborts the request, and permits recovery", async () => {
    const register = vi
      .fn()
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockResolvedValue(null);
    const service = new NeonPreviewDomainService(register, 15);
    await expect(service.ensure(input())).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(register.mock.calls[0][0].signal.aborted).toBe(true);
    await expect(service.ensure(input())).resolves.toBeUndefined();
  });

  it("cancels credential/request waits and never starts already-cancelled work", async () => {
    const register = vi.fn(() => new Promise<null>(() => {}));
    const service = new NeonPreviewDomainService(register);
    const controller = new AbortController();
    const work = service.ensure({ ...input(), signal: controller.signal });
    controller.abort(new Error("Stopped"));
    await expect(work).rejects.toThrow("Stopped");
    await expect(
      service.ensure({ ...input(), signal: controller.signal }),
    ).rejects.toThrow("Stopped");
    expect(register).toHaveBeenCalledTimes(1);
  });

  it.each([
    "http://app-43.localhost:42999",
    "http://app-42.localhost.evil:42999",
    "https://app-42.localhost:42999",
    "http://app-42.localhost",
    "http://app-42.localhost:42999/path",
  ])("rejects a non-preview origin %s", async (origin) => {
    const register = vi.fn();
    await expect(
      new NeonPreviewDomainService(register).ensure({ ...input(), origin }),
    ).rejects.toThrow("Invalid app preview origin");
    expect(register).not.toHaveBeenCalled();
  });

  it("uses the active runtime branch, independent of the deployment selection", async () => {
    mocks.findApp.mockResolvedValue({
      path: "app",
      neonProjectId: "project",
      neonActiveBranchId: "br-active",
      neonDevelopmentBranchId: "br-dev",
      selectedDatabaseBranchType: "production",
    });
    mocks.readEnv.mockResolvedValue([
      { key: "NEON_AUTH_BASE_URL", value: "https://auth.example" },
    ]);
    await expect(resolveNeonPreviewTarget(42)).resolves.toEqual({
      projectId: "project",
      branchId: "br-active",
    });
  });

  it("skips apps without a connection or without Neon Auth", async () => {
    mocks.findApp.mockResolvedValue({ path: "app", neonProjectId: null });
    await expect(resolveNeonPreviewTarget(42)).resolves.toBeNull();
    expect(mocks.readEnv).not.toHaveBeenCalled();
    mocks.findApp.mockResolvedValue({ path: "app", neonProjectId: "project" });
    mocks.readEnv.mockResolvedValue([
      { key: "DATABASE_URL", value: "postgres://local" },
    ]);
    await expect(resolveNeonPreviewTarget(42)).resolves.toBeNull();
  });
});
