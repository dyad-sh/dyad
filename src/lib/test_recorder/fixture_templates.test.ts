import { describe, expect, it } from "vitest";

import {
  generateTestUserFixtureSource,
  readFixtureMode,
} from "./fixture_templates";

describe("generateTestUserFixtureSource", () => {
  it("generates a Better Auth (Neon) sign-in helper", () => {
    const source = generateTestUserFixtureSource("neon-better-auth");
    expect(source).toContain("export async function signIn(page: Page)");
    expect(source).toContain("/api/auth/sign-in/email");
    expect(source).toContain("process.env.DYAD_TEST_USER_EMAIL");
    expect(source).toContain("process.env.DYAD_TEST_USER_PASSWORD");
    // The browser must own the request so Electron accepts Better Auth's
    // HttpOnly cookie in the same first-party session as the app page.
    expect(source).toContain("process.env.DYAD_TEST_BASE_URL");
    expect(source).toContain("await page.goto(origin)");
    expect(source).toContain("await page.evaluate(");
    expect(source).toContain('credentials: "include"');
    expect(source).not.toContain("page.request.post");
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

  it("stamps the auth mode so a fixture for the other backend is detectable", () => {
    // The two helpers share a signature but not a body, so an app that moved
    // between Neon and Supabase needs the file rewritten rather than reused.
    expect(
      readFixtureMode(generateTestUserFixtureSource("neon-better-auth")),
    ).toBe("neon-better-auth");
    expect(
      readFixtureMode(generateTestUserFixtureSource("supabase-password")),
    ).toBe("supabase-password");
  });

  it("reports a user-authored fixture as not Dyad-generated", () => {
    expect(readFixtureMode(`export async function signIn() {}\n`)).toBeNull();
  });
});
