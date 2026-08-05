import { describe, expect, it } from "vitest";
import { domainCheckVerdict, expectedServerAddress } from "./domain_check";

describe("domainCheckVerdict", () => {
  it("confirms a domain pointing at the server", () => {
    expect(
      domainCheckVerdict({ expectedIp: "1.2.3.4", actualIps: ["1.2.3.4"] }),
    ).toBe("ok");
  });

  it("accepts a server among several addresses", () => {
    expect(
      domainCheckVerdict({
        expectedIp: "1.2.3.4",
        actualIps: ["5.6.7.8", "1.2.3.4"],
      }),
    ).toBe("ok");
  });

  it("reports a domain pointing somewhere else", () => {
    expect(
      domainCheckVerdict({ expectedIp: "1.2.3.4", actualIps: ["5.6.7.8"] }),
    ).toBe("points-elsewhere");
  });

  it("reports a domain with no records, which can never pass a challenge", () => {
    expect(domainCheckVerdict({ expectedIp: "1.2.3.4", actualIps: [] })).toBe(
      "no-records",
    );
  });

  it("stays silent when there is nothing to compare against", () => {
    // Saying "could not confirm" here would fire for every user on Coolify's
    // own server, which teaches people to ignore the one that matters.
    expect(domainCheckVerdict({ expectedIp: null, actualIps: [] })).toBe(
      "unknown",
    );
    expect(
      domainCheckVerdict({ expectedIp: null, actualIps: ["1.2.3.4"] }),
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

  it("asks for a lookup when the instance is named rather than numbered", () => {
    expect(
      expectedServerAddress({
        serverIp: null,
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
    expect(expectedServerAddress({ serverIp: "::1", instanceUrl })).toEqual({
      kind: "ip",
      ip: "::1",
    });
    expect(
      expectedServerAddress({
        serverIp: null,
        instanceUrl: "http://[::1]:8000",
      }),
    ).toEqual({ kind: "ip", ip: "::1" });
  });
});
