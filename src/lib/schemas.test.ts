import { describe, expect, it } from "vitest";
import {
  getEffectiveAppSupabaseMode,
  hasSelfHostedSupabaseConfig,
} from "./schemas";

describe("getEffectiveAppSupabaseMode", () => {
  it("returns the explicit app mode when present", () => {
    expect(
      getEffectiveAppSupabaseMode({
        supabaseMode: "self-hosted",
        supabaseProjectId: "proj_123",
      }),
    ).toBe("self-hosted");
  });

  it("falls back to cloud for legacy linked apps without a stored mode", () => {
    expect(
      getEffectiveAppSupabaseMode({
        supabaseMode: null,
        supabaseProjectId: "proj_123",
      }),
    ).toBe("cloud");
  });

  it("returns null when the app has no Supabase project or mode", () => {
    expect(
      getEffectiveAppSupabaseMode({
        supabaseMode: null,
        supabaseProjectId: null,
      }),
    ).toBeNull();
  });
});

describe("hasSelfHostedSupabaseConfig", () => {
  it("requires both the API URL and secret key", () => {
    expect(
      hasSelfHostedSupabaseConfig({
        supabase: {
          selfHosted: {
            apiUrl: "https://supabase.internal",
          },
        },
      } as any),
    ).toBe(false);

    expect(
      hasSelfHostedSupabaseConfig({
        supabase: {
          selfHosted: {
            apiUrl: "https://supabase.internal",
            secretKey: { value: "secret" },
          },
        },
      } as any),
    ).toBe(true);
  });
});
