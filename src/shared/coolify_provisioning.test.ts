import { describe, expect, it } from "vitest";
import { shouldProvisionDatabase } from "./coolify_provisioning";

describe("shouldProvisionDatabase", () => {
  it("provisions for an app on portable Postgres", () => {
    expect(
      shouldProvisionDatabase({
        portableCodegen: true,
        supabaseProjectId: null,
      }),
    ).toBe(true);
  });

  it("leaves a Supabase app with its cloud backend", () => {
    expect(
      shouldProvisionDatabase({
        portableCodegen: false,
        supabaseProjectId: "abc",
      }),
    ).toBe(false);
  });

  it("does not provision for an app with no database configured", () => {
    expect(
      shouldProvisionDatabase({
        portableCodegen: false,
        supabaseProjectId: null,
      }),
    ).toBe(false);
  });

  it("prefers Supabase even if the portable flag somehow got set", () => {
    expect(
      shouldProvisionDatabase({
        portableCodegen: true,
        supabaseProjectId: "abc",
      }),
    ).toBe(false);
  });

  it("treats missing fields as no database", () => {
    expect(shouldProvisionDatabase({})).toBe(false);
  });
});
