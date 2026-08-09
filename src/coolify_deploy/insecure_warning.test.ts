import { describe, expect, it } from "vitest";
import { coolifyInsecureWarning } from "./insecure_warning";

const ask = (o: Partial<Parameters<typeof coolifyInsecureWarning>[0]>) =>
  coolifyInsecureWarning({
    isHttps: false,
    hasNeon: false,
    hasSupabase: false,
    ...o,
  });

describe("coolifyInsecureWarning", () => {
  it("says nothing once the app is served over TLS", () => {
    expect(ask({ isHttps: true, hasNeon: true })).toBe("none");
    expect(ask({ isHttps: true, hasSupabase: true })).toBe("none");
  });

  it("still warns for a domain the user typed as http", () => {
    // Coolify serves an explicit http:// domain without TLS, so this is the
    // same insecure context as having no domain at all.
    expect(ask({ isHttps: false, hasNeon: true })).toBe("breaks");
    expect(ask({ isHttps: false, hasSupabase: true })).toBe(
      "credentials-in-clear",
    );
  });

  it("says nothing for an app with no database, which has no sign-in", () => {
    expect(ask({})).toBe("none");
  });

  it("predicts a broken app for Neon Auth, which needs Web Crypto to load", () => {
    expect(ask({ hasNeon: true })).toBe("breaks");
  });

  it("warns about credentials in transit for Supabase, which still works", () => {
    // supabase-js checks for Web Crypto and falls back to a weaker exchange
    // rather than throwing, so this is a confidentiality problem, not an outage.
    expect(ask({ hasSupabase: true })).toBe("credentials-in-clear");
  });

  it("leads with the failure when an app somehow has both", () => {
    expect(ask({ hasNeon: true, hasSupabase: true })).toBe("breaks");
  });
});
