import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";

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
  ensureNeonAuthAllowLocalhost: vi.fn(),
  ensureNeonAuthTrustedDomain: vi.fn(),
}));

import {
  ensureNeonAuthAllowLocalhost,
  ensureNeonAuthTrustedDomain,
} from "../utils/neon_utils";
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ensureNeonAuthAllowLocalhost).mockReset().mockResolvedValue();
    vi.mocked(ensureNeonAuthTrustedDomain).mockReset().mockResolvedValue(null);
  });
  afterEach(() => vi.useRealTimers());

  it.each(["localhost", "app-42.localhost"])(
    "ensures localhost access when the preview uses %s",
    async (hostname) => {
      const request = { ...input(), origin: `http://${hostname}:42999` };
      await new NeonPreviewDomainService().ensureTrustedDomain(request);
      expect(ensureNeonAuthAllowLocalhost).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          projectId: "project",
          branchId: "br-active",
          signal: request.signal,
        }),
      );
      if (hostname === "localhost") {
        expect(ensureNeonAuthTrustedDomain).not.toHaveBeenCalled();
      } else {
        expect(ensureNeonAuthTrustedDomain).toHaveBeenCalledExactlyOnceWith({
          ...request.target,
          origin: request.origin,
          signal: request.signal,
        });
      }
    },
  );

  it("retries a rate-limited localhost update", async () => {
    vi.useFakeTimers();
    vi.mocked(ensureNeonAuthAllowLocalhost).mockRejectedValueOnce({
      response: { status: 429 },
    });
    const work = new NeonPreviewDomainService().ensureTrustedDomain(input());
    await vi.advanceTimersByTimeAsync(1_100);
    await work;
    expect(ensureNeonAuthAllowLocalhost).toHaveBeenCalledTimes(2);
    expect(ensureNeonAuthTrustedDomain).toHaveBeenCalledOnce();
  });

  it("does not register the app domain after cancellation during localhost setup", async () => {
    const controller = new AbortController();
    vi.mocked(ensureNeonAuthAllowLocalhost).mockImplementationOnce(async () => {
      controller.abort(new Error("Stopped"));
    });
    await expect(
      new NeonPreviewDomainService().ensureTrustedDomain({
        ...input(),
        signal: controller.signal,
      }),
    ).rejects.toThrow("Stopped");
    expect(ensureNeonAuthTrustedDomain).not.toHaveBeenCalled();
  });

  it.each([423, 429])("retries transient Neon %s responses", async (status) => {
    vi.useFakeTimers();
    const register = vi
      .fn()
      .mockRejectedValueOnce({ response: { status } })
      .mockResolvedValue(null);
    const work = new NeonPreviewDomainService(register).ensureTrustedDomain(
      input(),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(register).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_100);
    await work;
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("cancels retry backoff without sending another registration request", async () => {
    vi.useFakeTimers();
    const register = vi.fn().mockRejectedValue({ response: { status: 423 } });
    const controller = new AbortController();
    const work = new NeonPreviewDomainService(register).ensureTrustedDomain({
      ...input(),
      signal: controller.signal,
    });
    const rejected = expect(work).rejects.toThrow("Stopped");
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(new Error("Stopped"));
    await rejected;
    await vi.runAllTimersAsync();
    expect(register).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("deduplicates concurrent registration for the actual bound origin", async () => {
    let done!: () => void;
    const register = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          done = () => resolve(null);
        }),
    );
    const service = new NeonPreviewDomainService(register);
    const first = service.ensureTrustedDomain(input());
    const second = service.ensureTrustedDomain(input());
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
    await service.ensureTrustedDomain(input());
    await service.ensureTrustedDomain(input("br-temporary"));
    await service.ensureTrustedDomain({ ...input(), processId: 2 });
    await service.ensureTrustedDomain(input());
    expect(register).toHaveBeenCalledTimes(4);
    expect(register.mock.calls[1][0].branchId).toBe("br-temporary");
  });

  it("waits for the provider without imposing a registration deadline", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    let done!: () => void;
    const register = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          done = () => resolve(null);
        }),
    );
    try {
      const service = new NeonPreviewDomainService(register);
      const request = input();
      const work = service.ensureTrustedDomain(request);
      expect(register).toHaveBeenCalledWith(
        expect.objectContaining({ signal: request.signal }),
      );
      expect(timeout).not.toHaveBeenCalled();
      done();
      await expect(work).resolves.toBeUndefined();
    } finally {
      timeout.mockRestore();
    }
  });

  it("allows an explicit retry after a provider failure", async () => {
    const register = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValue(null);
    const service = new NeonPreviewDomainService(register);
    await expect(service.ensureTrustedDomain(input())).rejects.toThrow(
      "Network error",
    );
    await expect(service.ensureTrustedDomain(input())).resolves.toBeUndefined();
    expect(register).toHaveBeenCalledTimes(2);
  });

  it("cancels credential/request waits and never starts already-cancelled work", async () => {
    const register = vi.fn(() => new Promise<null>(() => {}));
    const service = new NeonPreviewDomainService(register);
    const controller = new AbortController();
    const work = service.ensureTrustedDomain({
      ...input(),
      signal: controller.signal,
    });
    controller.abort(new Error("Stopped"));
    await expect(work).rejects.toThrow("Stopped");
    await expect(
      service.ensureTrustedDomain({ ...input(), signal: controller.signal }),
    ).rejects.toThrow("Stopped");
    expect(register).toHaveBeenCalledTimes(1);
  });

  it.each([
    "not a URL",
    "http://localhost.evil:42999",
    "http://localhost:42999/path",
    "http://app-43.localhost:42999",
    "http://app-42.localhost.evil:42999",
    "https://app-42.localhost:42999",
    "http://app-42.localhost",
    "http://app-42.localhost:42999/path",
  ])("rejects a non-preview origin %s", async (origin) => {
    const register = vi.fn();
    await expect(
      new NeonPreviewDomainService(register).ensureTrustedDomain({
        ...input(),
        origin,
      }),
    ).rejects.toMatchObject({
      message: "Invalid app preview origin",
      kind: DyadErrorKind.Validation,
    });
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

  it("classifies a missing auth branch as an expected precondition failure", async () => {
    mocks.findApp.mockResolvedValue({ path: "app", neonProjectId: "project" });
    mocks.readEnv.mockResolvedValue([
      { key: "NEON_AUTH_BASE_URL", value: "https://auth.example" },
    ]);
    await expect(resolveNeonPreviewTarget(42)).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
    });
  });
});
