import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNeonClient } from "./neon_management_client";
import { getConnectionUri } from "./neon_context";

vi.mock("./neon_management_client", () => ({
  getNeonClient: vi.fn(),
}));

const getNeonClientMock = vi.mocked(getNeonClient);

describe("getConnectionUri", () => {
  beforeEach(() => {
    getNeonClientMock.mockReset();
  });

  it("forwards the pooled option to Neon", async () => {
    const neonClient = {
      listProjectBranchRoles: vi.fn().mockResolvedValue({
        data: { roles: [{ name: "neondb_owner", protected: false }] },
      }),
      listProjectBranchDatabases: vi.fn().mockResolvedValue({
        data: { databases: [{ name: "neondb" }] },
      }),
      getConnectionUri: vi.fn().mockResolvedValue({
        data: { uri: "postgresql://test" },
      }),
    };
    getNeonClientMock.mockResolvedValue(
      neonClient as unknown as Awaited<ReturnType<typeof getNeonClient>>,
    );

    await expect(
      getConnectionUri({
        projectId: "project-id",
        branchId: "branch-id",
        pooled: false,
      }),
    ).resolves.toBe("postgresql://test");

    expect(neonClient.getConnectionUri).toHaveBeenCalledWith({
      projectId: "project-id",
      branch_id: "branch-id",
      database_name: "neondb",
      role_name: "neondb_owner",
      pooled: false,
    });
  });
});
