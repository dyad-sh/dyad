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

  it("stays silent when a resolved domain cannot be compared", () => {
    // Saying "could not confirm" here would fire for every user on Coolify's
    // own server, which teaches people to ignore the one that matters.
    expect(
      domainCheckVerdict({ expectedIps: [], actualIps: ["1.2.3.4"] }),
    ).toBe("unknown");
  });

  it("still reports a domain with no records at all", () => {
    // Not the same silence: where the domain resolves, we lack only the
    // comparison. Where it resolves to nothing, that is a complete answer on
    // its own and holds whatever address the server turns out to have.
    expect(domainCheckVerdict({ expectedIps: [], actualIps: [] })).toBe(
      "no-records",
    );
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

/**
 * Every shape an address can arrive as, in both positions it can arrive in.
 *
 * Written as a table rather than a case per bug. Eight separate defects in
 * this one function were each "a shape handled in one position and not the
 * other" — the Docker alias, loopback names, loopback literals, bind-all
 * addresses, a bracketed IPv6, an absent address. A case per fix keeps
 * finding them one at a time; enumerating the space finds them together.
 */
describe("expectedServerAddress over every address shape", () => {
  const ROUTABLE_INSTANCE = "http://143.244.162.54:8000";

  // What a server address means when the instance is reachable and routable.
  const SERVER_SHAPES: Array<{
    shape: string;
    serverIp: string | null | undefined;
    expected: ReturnType<typeof expectedServerAddress>;
    why: string;
  }> = [
    {
      shape: "IPv4",
      serverIp: "5.6.7.8",
      expected: { kind: "ip", ip: "5.6.7.8" },
      why: "an address, used as given",
    },
    {
      shape: "IPv6",
      serverIp: "2606:4700::1",
      expected: { kind: "ip", ip: "2606:4700::1" },
      why: "an address, used as given",
    },
    {
      shape: "bracketed IPv6",
      serverIp: "[2606:4700::1]",
      expected: { kind: "ip", ip: "2606:4700::1" },
      why: "an address wearing the brackets URL adds, not a hostname",
    },
    {
      shape: "bracketed loopback IPv6",
      serverIp: "[::1]",
      expected: { kind: "ip", ip: "143.244.162.54" },
      why: "still loopback once the brackets come off",
    },
    {
      shape: "hostname",
      serverIp: "node-3.example.com",
      expected: { kind: "resolve", hostname: "node-3.example.com" },
      why: "a different machine from the instance, so resolved on its own",
    },
    {
      shape: "docker alias",
      serverIp: "host.docker.internal",
      expected: { kind: "ip", ip: "143.244.162.54" },
      why: "a container naming its own host, which is where the instance is",
    },
    {
      shape: "loopback name",
      serverIp: "localhost",
      expected: { kind: "ip", ip: "143.244.162.54" },
      why: "names the machine Coolify runs on, same as the docker alias",
    },
    {
      shape: "loopback IPv4",
      serverIp: "127.0.0.1",
      expected: { kind: "ip", ip: "143.244.162.54" },
      why: "a public domain must never be pointed at loopback",
    },
    {
      shape: "loopback IPv6",
      serverIp: "::1",
      expected: { kind: "ip", ip: "143.244.162.54" },
      why: "a public domain must never be pointed at loopback",
    },
    {
      shape: "bind-all IPv4",
      serverIp: "0.0.0.0",
      expected: { kind: "ip", ip: "143.244.162.54" },
      why: "every interface is not a reachable host",
    },
    {
      shape: "bind-all IPv6",
      serverIp: "::",
      expected: { kind: "ip", ip: "143.244.162.54" },
      why: "every interface is not a reachable host",
    },
    {
      shape: "private 10/8",
      serverIp: "10.0.0.5",
      expected: null,
      why: "a real machine, but not one a public record can be pointed at",
    },
    {
      shape: "private 192.168/16",
      serverIp: "192.168.1.50",
      expected: null,
      why: "the common homelab shape, and the advice would be impossible",
    },
    {
      shape: "private 172.16/12 low edge",
      serverIp: "172.16.0.1",
      expected: null,
      why: "the range starts at 172.16, not at 172.0",
    },
    {
      shape: "private 172.16/12 high edge",
      serverIp: "172.31.255.254",
      expected: null,
      why: "the range ends at 172.31",
    },
    {
      shape: "public 172 below the range",
      serverIp: "172.15.0.1",
      expected: { kind: "ip", ip: "172.15.0.1" },
      why: "172 alone is not private, so this one is answerable",
    },
    {
      shape: "public 172 above the range",
      serverIp: "172.32.0.1",
      expected: { kind: "ip", ip: "172.32.0.1" },
      why: "172 alone is not private, so this one is answerable",
    },
    {
      shape: "carrier-grade NAT",
      serverIp: "100.64.0.1",
      expected: null,
      why: "shared address space, unreachable from outside the carrier",
    },
    {
      shape: "public 100 below the NAT range",
      serverIp: "100.63.255.255",
      expected: { kind: "ip", ip: "100.63.255.255" },
      why: "100/8 is otherwise ordinary public space",
    },
    {
      shape: "link-local IPv4",
      serverIp: "169.254.1.1",
      expected: null,
      why: "an address a machine gave itself when nothing answered",
    },
    {
      shape: "unique local IPv6",
      serverIp: "fd00::1",
      expected: null,
      why: "the IPv6 equivalent of a private range",
    },
    {
      shape: "link-local IPv6",
      serverIp: "fe80::1",
      expected: null,
      why: "scoped to one link, so no record can point at it",
    },
    {
      shape: "site-local IPv6",
      serverIp: "fec0::1",
      expected: null,
      why: "deprecated rather than reassigned, so still nothing routes it",
    },
    {
      shape: "global unicast IPv6",
      serverIp: "2606:4700::1111",
      expected: { kind: "ip", ip: "2606:4700::1111" },
      why: "ordinary public space, and the control for the ranges above",
    },
    {
      shape: "IPv4-mapped private IPv6",
      serverIp: "::ffff:192.168.1.50",
      expected: null,
      why: "the same machine as 192.168.1.50, written the other way",
    },
    {
      shape: "link-local IPv6 with a dotted tail",
      serverIp: "fe80::203.0.113.5",
      expected: null,
      why: "the prefix decides; the tail only looks routable",
    },
    {
      shape: "unique local IPv6 with a dotted tail",
      serverIp: "fd00::8.8.8.8",
      expected: null,
      why: "same shape, and the tail is a public resolver's address",
    },
    {
      shape: "global unicast with a private dotted tail",
      serverIp: "2001:db8::10.0.0.1",
      expected: { kind: "ip", ip: "2001:db8::10.0.0.1" },
      why: "reading the tail here would suppress a routable address",
    },
    {
      shape: "deprecated IPv4-compatible IPv6",
      serverIp: "::192.168.1.50",
      expected: null,
      why: "carries the address rather than merely ending in one",
    },
    {
      shape: "IPv4-mapped public IPv6",
      serverIp: "::ffff:203.0.113.5",
      expected: { kind: "ip", ip: "::ffff:203.0.113.5" },
      why: "a mapped address is only as private as the address inside it",
    },
    {
      shape: "empty",
      serverIp: "",
      expected: null,
      why: "no address reported is not the same as naming Coolify's own host",
    },
    {
      shape: "null",
      serverIp: null,
      expected: null,
      why: "no address reported is not the same as naming Coolify's own host",
    },
    {
      shape: "undefined",
      serverIp: undefined,
      expected: null,
      why: "no address reported is not the same as naming Coolify's own host",
    },
  ];

  it.each(SERVER_SHAPES)(
    "reads a $shape server address as expected — $why",
    ({ serverIp, expected }) => {
      expect(
        expectedServerAddress({ serverIp, instanceUrl: ROUTABLE_INSTANCE }),
      ).toEqual(expected);
    },
  );

  // The same shapes again, now in the instance URL, reached by a server that
  // defers to it. Every one of these was a separate bug at some point.
  const INSTANCE_SHAPES: Array<{
    shape: string;
    instanceUrl: string;
    expected: ReturnType<typeof expectedServerAddress>;
  }> = [
    {
      shape: "IPv4",
      instanceUrl: "http://143.244.162.54:8000",
      expected: { kind: "ip", ip: "143.244.162.54" },
    },
    {
      shape: "bracketed IPv6",
      instanceUrl: "http://[2606:4700::1]:8000",
      expected: { kind: "ip", ip: "2606:4700::1" },
    },
    {
      shape: "hostname",
      instanceUrl: "https://coolify.example.com",
      expected: { kind: "resolve", hostname: "coolify.example.com" },
    },
    {
      shape: "loopback name",
      instanceUrl: "http://localhost:8000",
      expected: null,
    },
    {
      shape: "loopback IPv4",
      instanceUrl: "http://127.0.0.1:8000",
      expected: null,
    },
    {
      shape: "bracketed loopback IPv6",
      instanceUrl: "http://[::1]:8000",
      expected: null,
    },
    { shape: "unparseable", instanceUrl: "", expected: null },
  ];

  it.each(INSTANCE_SHAPES)(
    "reads a $shape instance address as expected when the server defers to it",
    ({ instanceUrl, expected }) => {
      expect(
        expectedServerAddress({
          serverIp: "host.docker.internal",
          instanceUrl,
        }),
      ).toEqual(expected);
    },
  );
});
