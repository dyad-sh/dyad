import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNeonClient } from "./neon_management_client";
import {
  getConnectionUri,
  isEnumValueAddition,
  ensureAddValueIfNotExists,
  partitionEnumValueAdditions,
} from "./neon_context";

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

describe("isEnumValueAddition", () => {
  it("matches ALTER TYPE ... ADD VALUE statements", () => {
    expect(
      isEnumValueAddition(`ALTER TYPE "public"."mood" ADD VALUE 'ok'`),
    ).toBe(true);
    expect(
      isEnumValueAddition(
        `ALTER TYPE "public"."mood" ADD VALUE 'ok' BEFORE 'sad'`,
      ),
    ).toBe(true);
    expect(isEnumValueAddition("alter type mood add value 'ok'")).toBe(true);
  });

  it("does not match other statements", () => {
    expect(
      isEnumValueAddition(`CREATE TYPE "public"."mood" AS ENUM ('ok')`),
    ).toBe(false);
    expect(
      isEnumValueAddition(
        `ALTER TABLE "public"."messages" ALTER COLUMN "mood" SET DEFAULT 'ok'::"public"."mood"`,
      ),
    ).toBe(false);
  });
});

describe("ensureAddValueIfNotExists", () => {
  it("inserts IF NOT EXISTS while preserving the label and clauses", () => {
    expect(
      ensureAddValueIfNotExists(`ALTER TYPE "public"."mood" ADD VALUE 'ok'`),
    ).toBe(`ALTER TYPE "public"."mood" ADD VALUE IF NOT EXISTS 'ok'`);
    expect(
      ensureAddValueIfNotExists(
        `ALTER TYPE "public"."mood" ADD VALUE 'ok' BEFORE 'sad'`,
      ),
    ).toBe(
      `ALTER TYPE "public"."mood" ADD VALUE IF NOT EXISTS 'ok' BEFORE 'sad'`,
    );
  });

  it("is idempotent", () => {
    const once = ensureAddValueIfNotExists(
      `ALTER TYPE "public"."mood" ADD VALUE 'ok'`,
    );
    expect(ensureAddValueIfNotExists(once)).toBe(once);
  });
});

describe("partitionEnumValueAdditions", () => {
  it("separates enum additions from the rest, preserving order", () => {
    const statements = [
      `ALTER TYPE "public"."mood" ADD VALUE 'ok'`,
      `ALTER TABLE "public"."messages" ALTER COLUMN "mood" SET DEFAULT 'ok'::"public"."mood"`,
      `ALTER TYPE "public"."mood" ADD VALUE 'great'`,
    ];
    expect(partitionEnumValueAdditions(statements)).toEqual({
      enumValueAdditions: [
        `ALTER TYPE "public"."mood" ADD VALUE 'ok'`,
        `ALTER TYPE "public"."mood" ADD VALUE 'great'`,
      ],
      transactionStatements: [
        `ALTER TABLE "public"."messages" ALTER COLUMN "mood" SET DEFAULT 'ok'::"public"."mood"`,
      ],
    });
  });

  it("keeps every statement in the transaction when there are no enum additions", () => {
    const statements = [
      `CREATE TABLE "public"."a" ("id" integer)`,
      `ALTER TABLE "public"."a" ADD COLUMN "name" text`,
    ];
    expect(partitionEnumValueAdditions(statements)).toEqual({
      enumValueAdditions: [],
      transactionStatements: statements,
    });
  });
});
