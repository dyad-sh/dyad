import { beforeEach, describe, expect, it, vi } from "vitest";
import { DyadErrorKind } from "@/errors/dyad_error";
import { neonTemplateHook } from "./template_hook";

const mocks = vi.hoisted(() => ({
  createProject: vi.fn(),
  getBranchEnvVars: vi.fn(),
  setAppEnvVars: vi.fn(),
}));

vi.mock("@/ipc/types", () => ({
  ipc: {
    neon: {
      createProject: mocks.createProject,
      getBranchEnvVars: mocks.getBranchEnvVars,
    },
    misc: {
      setAppEnvVars: mocks.setAppEnvVars,
    },
  },
}));

describe("neonTemplateHook", () => {
  beforeEach(() => {
    mocks.createProject.mockReset();
    mocks.getBranchEnvVars.mockReset();
    mocks.setAppEnvVars.mockReset();
  });

  it("resumes env persistence when a previous attempt already linked Neon", async () => {
    mocks.createProject
      .mockResolvedValueOnce({
        id: "project-1",
        name: "Test App",
        connectionString: "postgres://initial",
        branchId: "branch-1",
      })
      .mockRejectedValueOnce(
        Object.assign(
          new Error(
            "This app already has a Neon project linked. Disconnect it first.",
          ),
          { kind: DyadErrorKind.Precondition },
        ),
      );
    mocks.setAppEnvVars
      .mockRejectedValueOnce(new Error("env file busy"))
      .mockResolvedValueOnce(undefined);
    mocks.getBranchEnvVars.mockResolvedValue({
      databaseUrl: "postgres://recovered",
    });

    await expect(
      neonTemplateHook({ appId: 1, appName: "Test App" }),
    ).rejects.toThrow("env file busy");
    await neonTemplateHook({ appId: 1, appName: "Test App" });

    expect(mocks.createProject).toHaveBeenCalledTimes(2);
    expect(mocks.getBranchEnvVars).toHaveBeenCalledWith({
      appId: 1,
      branchType: "development",
    });
    expect(mocks.setAppEnvVars).toHaveBeenLastCalledWith({
      appId: 1,
      envVars: expect.arrayContaining([
        { key: "POSTGRES_URL", value: "postgres://recovered" },
      ]),
    });
  });

  it("does not hide unrelated Neon precondition failures", async () => {
    const error = Object.assign(new Error("Connect Supabase first"), {
      kind: DyadErrorKind.Precondition,
    });
    mocks.createProject.mockRejectedValue(error);

    await expect(
      neonTemplateHook({ appId: 1, appName: "Test App" }),
    ).rejects.toBe(error);
    expect(mocks.getBranchEnvVars).not.toHaveBeenCalled();
    expect(mocks.setAppEnvVars).not.toHaveBeenCalled();
  });
});
