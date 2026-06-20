import { describe, expect, it } from "vitest";
import {
  buildVercelEnvPayload,
  canonicalOrigin,
  reconcileTrustedDomains,
  VERCEL_ENV_TARGETS,
  type NeonBranchEnvValues,
} from "@/ipc/utils/vercel_neon_sync_helpers";

const baseVars: NeonBranchEnvValues = {
  databaseUrl: "postgresql://user:pass@host.neon.tech/db",
  neonAuthBaseUrl: "https://host.neonauth.aws.neon.tech/neondb/auth",
  neonAuthCookieSecret: "deadbeef".repeat(8),
  isNextJs: true,
};

describe("buildVercelEnvPayload", () => {
  it("includes all three keys for a Next.js app with auth active", () => {
    const payload = buildVercelEnvPayload(baseVars, {
      target: VERCEL_ENV_TARGETS,
    });
    expect(payload.map((p) => p.key)).toEqual([
      "DATABASE_URL",
      "NEON_AUTH_BASE_URL",
      "NEON_AUTH_COOKIE_SECRET",
    ]);
    // Every var targets only the production Vercel environment and is
    // encrypted (preview/development are intentionally excluded).
    for (const entry of payload) {
      expect(entry.type).toBe("encrypted");
      expect(entry.target).toEqual(["production"]);
    }
  });

  it("omits the cookie secret for non-Next.js apps even if a secret is passed", () => {
    const payload = buildVercelEnvPayload(
      { ...baseVars, isNextJs: false },
      { target: VERCEL_ENV_TARGETS },
    );
    expect(payload.map((p) => p.key)).toEqual([
      "DATABASE_URL",
      "NEON_AUTH_BASE_URL",
    ]);
    expect(payload.some((p) => p.key === "NEON_AUTH_COOKIE_SECRET")).toBe(
      false,
    );
  });

  it("pushes only DATABASE_URL when Neon Auth is inactive", () => {
    const payload = buildVercelEnvPayload(
      {
        databaseUrl: baseVars.databaseUrl,
        isNextJs: true,
      },
      { target: VERCEL_ENV_TARGETS },
    );
    expect(payload.map((p) => p.key)).toEqual(["DATABASE_URL"]);
  });

  it("never includes POSTGRES_URL", () => {
    const payload = buildVercelEnvPayload(baseVars, {
      target: VERCEL_ENV_TARGETS,
    });
    expect(payload.some((p) => p.key === "POSTGRES_URL")).toBe(false);
  });
});

describe("canonicalOrigin", () => {
  it("normalizes scheme, case, path, and trailing slash to one origin", () => {
    const expected = "https://myapp.vercel.app";
    expect(canonicalOrigin("myapp.vercel.app")).toBe(expected);
    expect(canonicalOrigin("https://myapp.vercel.app")).toBe(expected);
    expect(canonicalOrigin("https://myapp.vercel.app/")).toBe(expected);
    expect(canonicalOrigin("http://MyApp.Vercel.app/some/path?q=1")).toBe(
      expected,
    );
    expect(canonicalOrigin("  MyApp.Vercel.App  ")).toBe(expected);
  });

  it("returns null for empty or wildcard hosts", () => {
    expect(canonicalOrigin("")).toBeNull();
    expect(canonicalOrigin("   ")).toBeNull();
    expect(canonicalOrigin("*.vercel.app")).toBeNull();
  });
});

describe("reconcileTrustedDomains", () => {
  it("returns only the missing origins, canonicalized and https-prefixed", () => {
    const existing = ["https://already.vercel.app"];
    const desired = ["already.vercel.app", "https://new-app.vercel.app/"];
    expect(reconcileTrustedDomains(existing, desired)).toEqual([
      "https://new-app.vercel.app",
    ]);
  });

  it("dedupes equivalent desired hosts and excludes wildcards", () => {
    const result = reconcileTrustedDomains(
      [],
      [
        "app.vercel.app",
        "https://app.vercel.app/",
        "APP.vercel.app",
        "*.vercel.app",
      ],
    );
    expect(result).toEqual(["https://app.vercel.app"]);
  });

  it("returns an empty array when everything is already present", () => {
    expect(
      reconcileTrustedDomains(
        ["https://app.vercel.app"],
        ["app.vercel.app", "https://app.vercel.app"],
      ),
    ).toEqual([]);
  });
});
