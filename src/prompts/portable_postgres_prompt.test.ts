import { describe, expect, it } from "vitest";
import { getPortablePostgresSystemPrompt } from "./portable_postgres_prompt";

describe("getPortablePostgresSystemPrompt", () => {
  const nextjs = getPortablePostgresSystemPrompt("nextjs");
  const other = getPortablePostgresSystemPrompt("vite");

  it("forbids every provider-specific client", () => {
    for (const banned of [
      "@neondatabase/serverless",
      "@neondatabase/auth",
      "@supabase/supabase-js",
    ]) {
      expect(nextjs).toContain(banned);
    }
    expect(nextjs).toMatch(/NEVER install or import/);
  });

  it("forbids provider auth and provider RLS helpers", () => {
    expect(nextjs).toMatch(/no-vendor-auth/);
    expect(nextjs).toMatch(/auth\.user_id\(\)/);
  });

  it("keeps the connection string off the client", () => {
    expect(nextjs).toMatch(/no-db-url-client-side/);
    expect(nextjs).toMatch(/"use client"/);
  });

  it("derives TLS from the connection string so one path serves both databases", () => {
    // Managed Postgres requires TLS; a self-hosted one usually has none.
    expect(nextjs).toContain("sslmode");
    expect(nextjs).toContain("rejectUnauthorized");
  });

  it("tells non-Next apps to bind the provided port and interface", () => {
    expect(other).toContain("process.env.PORT");
    expect(other).toContain("0.0.0.0");
  });

  it("requires the connection to be made lazily", () => {
    // A pool opened, or a missing DATABASE_URL thrown on, at module scope
    // makes the app fail to build rather than fail to serve, because builds
    // evaluate server modules.
    expect(nextjs).toMatch(/no-db-at-module-scope/);
    expect(nextjs).toContain("getPool()");
    expect(nextjs).toMatch(/lazily/i);
  });

  it("does not also tell the model to connect at module scope", () => {
    expect(nextjs).not.toMatch(/Create it once at module scope/);
  });

  it("routes schema changes through the existing execute-sql tag", () => {
    expect(nextjs).toContain("<dyad-execute-sql>");
  });

  it("uses parameterised queries in its examples", () => {
    expect(nextjs).toContain("$1");
    expect(nextjs).toMatch(/Never build SQL by concatenating user input/i);
  });
});
