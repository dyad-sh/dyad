import { describe, expect, it } from "vitest";

import { generateTestUserFixtureSource } from "./fixture_templates";

describe("generateTestUserFixtureSource", () => {
  it("generates a Better Auth (Neon) sign-in helper", () => {
    const source = generateTestUserFixtureSource("neon-better-auth");
    expect(source).toContain("export async function signIn(page: Page)");
    expect(source).toContain('page.request.post("/api/auth/sign-in/email"');
    expect(source).toContain("process.env.DYAD_TEST_USER_EMAIL");
    expect(source).toContain("process.env.DYAD_TEST_USER_PASSWORD");
    // Should NOT reference Supabase-only env vars.
    expect(source).not.toContain("DYAD_TEST_SUPABASE_ANON_KEY");
  });

  it("generates a Supabase password-grant sign-in helper", () => {
    const source = generateTestUserFixtureSource("supabase-password");
    expect(source).toContain("export async function signIn(page: Page)");
    expect(source).toContain("/auth/v1/token?grant_type=password");
    expect(source).toContain("process.env.DYAD_TEST_SUPABASE_URL");
    expect(source).toContain("process.env.DYAD_TEST_SUPABASE_ANON_KEY");
    expect(source).toContain("addInitScript");
    expect(source).toContain("sb-${projectRef}-auth-token");
  });
});
