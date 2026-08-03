import { describe, expect, it } from "vitest";
import {
  coolifyDomainHostname,
  normalizeCoolifyDomain,
} from "./coolify_domain";

describe("normalizeCoolifyDomain", () => {
  it("adds https to a bare hostname, which is what people type", () => {
    // Coolify validates this field as a URL and 422s on a bare hostname.
    expect(normalizeCoolifyDomain("myapp2.duckdns.org")).toBe(
      "https://myapp2.duckdns.org",
    );
  });

  it("keeps an explicit scheme", () => {
    expect(normalizeCoolifyDomain("http://myapp2.duckdns.org")).toBe(
      "http://myapp2.duckdns.org",
    );
    expect(normalizeCoolifyDomain("https://app.example.com")).toBe(
      "https://app.example.com",
    );
  });

  it("trims whitespace and a trailing slash", () => {
    expect(normalizeCoolifyDomain("  app.example.com/  ")).toBe(
      "https://app.example.com",
    );
  });

  it("keeps a path, which Coolify supports", () => {
    expect(normalizeCoolifyDomain("app.example.com/admin")).toBe(
      "https://app.example.com/admin",
    );
  });

  it("keeps a port", () => {
    expect(normalizeCoolifyDomain("app.example.com:8443")).toBe(
      "https://app.example.com:8443",
    );
  });

  it("rejects empty input", () => {
    expect(normalizeCoolifyDomain("")).toBeNull();
    expect(normalizeCoolifyDomain("   ")).toBeNull();
  });

  it("rejects a scheme Coolify does not support", () => {
    expect(normalizeCoolifyDomain("ftp://app.example.com")).toBeNull();
  });
});

describe("coolifyDomainHostname", () => {
  it("strips the scheme and path for a DNS lookup", () => {
    expect(coolifyDomainHostname("https://app.example.com/admin")).toBe(
      "app.example.com",
    );
    expect(coolifyDomainHostname("myapp2.duckdns.org")).toBe(
      "myapp2.duckdns.org",
    );
  });

  it("returns null for input that is not a domain", () => {
    expect(coolifyDomainHostname("   ")).toBeNull();
  });
});
