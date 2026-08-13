import { describe, expect, it } from "vitest";
import {
  coolifyInsecureWarning,
  coolifyServedOverHttps,
} from "./insecure_warning";

/**
 * Whether a deploy will be reachable over TLS.
 *
 * Coolify fixes an app's address when it creates the application, so a server's
 * wildcard domain only predicts where an app that does not exist yet will land.
 */
describe("predicting the scheme a deploy will be served on", () => {
  const NOTHING_KNOWN = { deployedUrl: null, wildcardDomain: undefined };

  it("takes a typed https domain as the answer", () => {
    expect(
      coolifyServedOverHttps({
        domain: "https://a.example.com",
        ...NOTHING_KNOWN,
      }),
    ).toBe(true);
  });

  it("takes a typed http domain as the answer", () => {
    expect(
      coolifyServedOverHttps({
        domain: "http://a.example.com",
        ...NOTHING_KNOWN,
      }),
    ).toBe(false);
  });

  it("prefers what was typed over where the app already is", () => {
    // A typed domain is what the next deploy sends, so it outranks both the
    // address the app is on and anything the server would generate.
    expect(
      coolifyServedOverHttps({
        domain: "http://a.example.com",
        deployedUrl: "https://live.example.com",
        wildcardDomain: "https://apps.example.com",
      }),
    ).toBe(false);
  });

  it("keeps an existing app's address over the server's wildcard", () => {
    // The case this ordering exists for: an app on a plain sslip address stays
    // there when a wildcard is added later, because a domain-less redeploy
    // sends no domains and nothing regenerates the address.
    expect(
      coolifyServedOverHttps({
        domain: "",
        deployedUrl: "http://x.203.0.113.10.sslip.io",
        wildcardDomain: "https://apps.example.com",
      }),
    ).toBe(false);
  });

  it("reports an existing app on an https address as secure", () => {
    expect(
      coolifyServedOverHttps({
        domain: "",
        deployedUrl: "https://live.example.com",
        wildcardDomain: null,
      }),
    ).toBe(true);
  });

  it("predicts from the wildcard when no application exists yet", () => {
    expect(
      coolifyServedOverHttps({
        domain: "",
        deployedUrl: null,
        wildcardDomain: "https://apps.example.com",
      }),
    ).toBe(true);
  });

  it("says plain when the wildcard itself is plain", () => {
    expect(
      coolifyServedOverHttps({
        domain: "",
        deployedUrl: null,
        wildcardDomain: "http://apps.example.com",
      }),
    ).toBe(false);
  });

  it("says plain when the server reported no wildcard, which means sslip", () => {
    expect(
      coolifyServedOverHttps({
        domain: "",
        deployedUrl: null,
        wildcardDomain: null,
      }),
    ).toBe(false);
  });

  it("warns rather than guesses when the server reported nothing at all", () => {
    expect(coolifyServedOverHttps({ domain: "", ...NOTHING_KNOWN })).toBe(
      false,
    );
  });
});

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
