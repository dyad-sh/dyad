import { describe, expect, it } from "vitest";
import { domainCheckVerdict, expectedServerAddress } from "./domain_check";

describe("domainCheckVerdict", () => {
  it("confirms a domain pointing at the server", () => {
    expect(
      domainCheckVerdict({ expectedIps: ["1.2.3.4"], actualIps: ["1.2.3.4"] }),
    ).toBe("ok");
  });

  it("accepts a server among several addresses", () => {
    expect(
      domainCheckVerdict({
        expectedIps: ["1.2.3.4"],
        actualIps: ["5.6.7.8", "1.2.3.4"],
      }),
    ).toBe("ok");
  });

  it("reports a domain pointing somewhere else", () => {
    expect(
      domainCheckVerdict({ expectedIps: ["1.2.3.4"], actualIps: ["5.6.7.8"] }),
    ).toBe("points-elsewhere");
  });

  it("reports a domain with no records, which can never pass a challenge", () => {
    expect(
      domainCheckVerdict({ expectedIps: ["1.2.3.4"], actualIps: [] }),
    ).toBe("no-records");
  });

  it("accepts an IPv6 server address", () => {
    // An AAAA-only domain is configured, not misconfigured.
    expect(
      domainCheckVerdict({
        expectedIps: ["2606:4700::1"],
        actualIps: ["2606:4700::1"],
      }),
    ).toBe("ok");
  });

  it("stays silent when there is nothing to compare against", () => {
    // Saying "could not confirm" here would fire for every user on Coolify's
    // own server, which teaches people to ignore the one that matters.
    expect(domainCheckVerdict({ expectedIps: [], actualIps: [] })).toBe(
      "unknown",
    );
    expect(
      domainCheckVerdict({ expectedIps: [], actualIps: ["1.2.3.4"] }),
    ).toBe("unknown");
  });
});

describe("expectedServerAddress", () => {
  const instanceUrl = "http://143.244.162.54:8000";

  it("uses the address Coolify reports for a remote server", () => {
    expect(expectedServerAddress({ serverIp: "5.6.7.8", instanceUrl })).toEqual(
      { kind: "ip", ip: "5.6.7.8" },
    );
  });

  it("falls back to the instance for Coolify's own server", () => {
    // Coolify reports its own host as host.docker.internal, which is not an
    // address and can never match a DNS record.
    expect(
      expectedServerAddress({ serverIp: "host.docker.internal", instanceUrl }),
    ).toEqual({ kind: "ip", ip: "143.244.162.54" });
  });

  it("says nothing when Coolify reports no address for the server", () => {
    // Coolify can omit the address, and the picker can hold a server the
    // current list no longer has. Neither means the app runs where Coolify
    // does, and guessing would fail a correctly pointed domain.
    expect(
      expectedServerAddress({
        serverIp: null,
        instanceUrl: "https://coolify.example.com",
      }),
    ).toBeNull();
  });

  it("asks for a lookup when Coolify's own host is named rather than numbered", () => {
    expect(
      expectedServerAddress({
        serverIp: "host.docker.internal",
        instanceUrl: "https://coolify.example.com",
      }),
    ).toEqual({ kind: "resolve", hostname: "coolify.example.com" });
  });

  it("gives up rather than guessing when the instance URL is unusable", () => {
    expect(
      expectedServerAddress({
        serverIp: "host.docker.internal",
        instanceUrl: "",
      }),
    ).toBeNull();
  });

  it("handles IPv6 on both sides", () => {
    // A routable v6 address, since ::1 is loopback and is handled elsewhere.
    expect(
      expectedServerAddress({ serverIp: "2606:4700::1", instanceUrl }),
    ).toEqual({
      kind: "ip",
      ip: "2606:4700::1",
    });
    expect(
      expectedServerAddress({
        serverIp: "host.docker.internal",
        instanceUrl: "http://[::1]:8000",
      }),
    ).toEqual({ kind: "ip", ip: "::1" });
  });
});

describe("domainCheckVerdict with several addresses", () => {
  it("accepts a dual-stack host answering on one family", () => {
    // The instance resolves to both; the app domain has only the v6 record.
    expect(
      domainCheckVerdict({
        expectedIps: ["1.2.3.4", "2606:4700::1"],
        actualIps: ["2606:4700::1"],
      }),
    ).toBe("ok");
  });

  it("treats the compressed and expanded spellings of one address as equal", () => {
    expect(
      domainCheckVerdict({
        expectedIps: ["2606:4700:0000:0000:0000:0000:0000:0001"],
        actualIps: ["2606:4700::1"],
      }),
    ).toBe("ok");
  });

  it("still reports a genuinely different address", () => {
    expect(
      domainCheckVerdict({
        expectedIps: ["1.2.3.4", "2606:4700::1"],
        actualIps: ["9.9.9.9"],
      }),
    ).toBe("points-elsewhere");
  });
});

describe("expectedServerAddress for a named remote server", () => {
  it("resolves the server's own hostname rather than the instance", () => {
    // A remote server Coolify reports by name is still a different machine
    // from the instance, so checking the domain against the instance would
    // compare against the wrong host.
    expect(
      expectedServerAddress({
        serverIp: "node-3.example.com",
        instanceUrl: "https://coolify.example.com",
      }),
    ).toEqual({ kind: "resolve", hostname: "node-3.example.com" });
  });

  it("still stands in for Coolify's own server", () => {
    expect(
      expectedServerAddress({
        serverIp: "host.docker.internal",
        instanceUrl: "http://143.244.162.54:8000",
      }),
    ).toEqual({ kind: "ip", ip: "143.244.162.54" });
  });
});

describe("expectedServerAddress and unusable server names", () => {
  it("does not resolve a loopback name, which would name the user's own machine", () => {
    expect(
      expectedServerAddress({
        serverIp: "localhost",
        instanceUrl: "http://143.244.162.54:8000",
      }),
    ).toEqual({ kind: "ip", ip: "143.244.162.54" });
  });
});

describe("expectedServerAddress and loopback servers", () => {
  it("treats a loopback literal like Coolify's own host, not as an answer", () => {
    // Telling someone to point a public domain at 127.0.0.1 is the one
    // instruction guaranteed to be wrong.
    expect(
      expectedServerAddress({
        serverIp: "127.0.0.1",
        instanceUrl: "http://143.244.162.54:8000",
      }),
    ).toEqual({ kind: "ip", ip: "143.244.162.54" });
    expect(
      expectedServerAddress({
        serverIp: "::1",
        instanceUrl: "http://143.244.162.54:8000",
      }),
    ).toEqual({ kind: "ip", ip: "143.244.162.54" });
  });
});
