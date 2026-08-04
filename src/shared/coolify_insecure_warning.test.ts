import { describe, expect, it } from "vitest";
import { coolifyInsecureWarning } from "./coolify_insecure_warning";

const ask = (o: Partial<Parameters<typeof coolifyInsecureWarning>[0]>) =>
  coolifyInsecureWarning({
    hasDomain: false,
    hasNeon: false,
    hasSupabase: false,
    ...o,
  });

describe("coolifyInsecureWarning", () => {
  it("says nothing once a domain is set", () => {
    expect(ask({ hasDomain: true, hasNeon: true })).toBe("none");
    expect(ask({ hasDomain: true, hasSupabase: true })).toBe("none");
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
