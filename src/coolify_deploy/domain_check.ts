import { isIP } from "node:net";

/** What Coolify reports as the address of the machine it runs on. */
const DOCKER_HOST_ALIAS = "host.docker.internal";

/**
 * Whether a value names the machine asking rather than a reachable server.
 *
 * Covers both spellings, because answering with either would have us tell the
 * user to point a public domain at a loopback address.
 */
export function isLoopbackAddress(value: string | null | undefined): boolean {
  if (!value) return false;
  const bare = value
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (/^(localhost|.*\.localhost)$/.test(bare)) return true;
  // 0.0.0.0 means every interface rather than a reachable host, so it is no
  // more an answer than a loopback address is.
  if (isIP(bare) === 4) return bare.startsWith("127.") || bare === "0.0.0.0";
  return (
    isIP(bare) === 6 &&
    (bare === "::1" || bare === "0:0:0:0:0:0:0:1" || bare === "::")
  );
}

/**
 * Whether an address is real but unreachable from the public internet.
 *
 * Distinct from loopback, which means "wherever Coolify is" and falls back to
 * the instance URL. A server on 192.168.1.50 is a genuine machine somewhere
 * else — it just is not somewhere a public DNS record can be pointed, so the
 * only honest answer about where a domain should point is that we do not know.
 * Homelab and NAT installs are a common Coolify shape, and telling one of them
 * to point a domain at a private address is advice nobody can follow.
 */
export function isNonRoutableAddress(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const bare = value
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  const family = isIP(bare);
  if (family === 4) return isNonRoutableIpv4(bare);
  if (family !== 6) return false;
  // Two prefixes and nothing else. This is not a return to classifying IPv6 —
  // see isDeferredIpv6, which still declines every one of them as an address
  // to name. It is only enough to keep an address the public internet cannot
  // reach from vouching that a domain arrives at this server, which is the
  // same thing isNonRoutableIpv4 does for 192.168.0.0/16.
  //
  // Deliberately no handling of the ::ffff:a.b.c.d forms or their expanded
  // spellings: those are where reading IPv6 by pattern kept going wrong, and
  // a private address written that way does not appear in public DNS.
  const first = bare.startsWith("::") ? "" : bare.split(":")[0];
  if (!first) return false;
  const head = Number.parseInt(first, 16);
  if (Number.isNaN(head)) return false;
  if (head >= 0xfc00 && head <= 0xfdff) return true; // fc00::/7, unique local
  // fec0::/10 was deprecated rather than reassigned, so nothing routes it.
  if (head >= 0xfec0 && head <= 0xfeff) return true;
  return head >= 0xfe80 && head <= 0xfebf; // fe80::/10, link-local
}

/**
 * Whether a literal is one this check refuses to reason about.
 *
 * The same IPv6 address has too many spellings for a partial answer to be
 * anything but a wrong one: ::ffff:192.168.1.50 and its expanded form name a
 * private machine, while fe80::203.0.113.5 is link-local despite ending in a
 * public-looking address. Getting it wrong means telling someone to point
 * their domain at an address nothing can reach, so until this is handled
 * properly the check says nothing about an IPv6 server rather than guessing.
 *
 * Applied to resolved addresses as well as reported ones. A server named
 * nas.local answering on fd00::1 is the same machine as one reported as
 * fd00::1, so answering differently for the two would defer on paper only.
 */
export function isDeferredIpv6(value: string | null | undefined): boolean {
  if (!value) return false;
  return isIP(value.trim().replace(/^\[|\]$/g, "")) === 6;
}

function isNonRoutableIpv4(bare: string): boolean {
  const [a, b] = bare.split(".").map(Number);
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10, CGNAT
  return a === 169 && b === 254; // 169.254.0.0/16, link-local
}

/**
 * What a DNS pre-check concluded about a domain.
 *
 * `unknown` exists so a check that could not run stays silent. Coolify asks a
 * certificate authority for a certificate the moment a real domain is saved,
 * and a failed challenge leaves the site on a self-signed certificate — a
 * browser warning for its visitors, cleared only by deleting the proxy's
 * acme.json and restarting it, with Let's Encrypt rate-limiting repeat
 * attempts meanwhile. Worth warning about; not worth guessing about, since a
 * warning that appears when nothing is wrong is one people learn to ignore.
 */
export type DomainCheckVerdict =
  | "ok"
  | "points-elsewhere"
  | "no-records"
  | "unknown";

export function domainCheckVerdict({
  expectedIps,
  actualIps,
}: {
  /** Every address the server is known by; a host can have several. */
  expectedIps: string[];
  actualIps: string[];
}): DomainCheckVerdict {
  // A domain with no records at all is a fact about the domain, true whatever
  // the server's address turns out to be — so it is said even when there is
  // nothing to compare it against.
  if (actualIps.length === 0) return "no-records";
  // Nothing to compare against: we know nothing, so we claim nothing.
  if (expectedIps.length === 0) return "unknown";
  // Families have to meet before an answer means anything. An IPv4 address is
  // no evidence about an AAAA record, so comparing across them finds no
  // overlap by construction — and a domain correctly pointed at this very
  // machine over the other family would read as pointed somewhere else.
  const expectedFamilies = new Set(
    expectedIps.map((ip) => isIP(canonicalAddress(ip))),
  );
  if (
    !actualIps.some((ip) => expectedFamilies.has(isIP(canonicalAddress(ip))))
  ) {
    return "unknown";
  }
  const expected = new Set(expectedIps.map(canonicalAddress));
  // Any overlap is enough: a dual-stack host answering on one family is
  // correctly configured, not pointed somewhere else.
  return actualIps.some((ip) => expected.has(canonicalAddress(ip)))
    ? "ok"
    : "points-elsewhere";
}

/**
 * One spelling per address, so the two sides compare equal.
 *
 * DNS returns IPv6 compressed while other sources may expand it, and the two
 * forms of the same address must not read as a mismatch.
 */
function canonicalAddress(value: string): string {
  const bare = value
    .trim()
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (isIP(bare) !== 6) return bare;
  try {
    // The URL parser emits the canonical compressed form.
    return new URL(`http://[${bare}]`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return bare;
  }
}

/**
 * Where to expect the server, given what Coolify reports about it.
 *
 * Coolify's built-in server is the machine Coolify itself runs on, and it
 * reports that machine as `host.docker.internal` — a container naming its own
 * host, not an address DNS can match. The instance URL points at the same
 * machine, so it stands in for that value alone. Any other name belongs to a
 * different machine and is resolved on its own.
 */
export function expectedServerAddress({
  serverIp,
  instanceUrl,
}: {
  serverIp: string | null | undefined;
  instanceUrl: string;
}): { kind: "ip"; ip: string } | { kind: "resolve"; hostname: string } | null {
  // Names for the machine Coolify itself runs on. A loopback address means
  // the same thing as host.docker.internal does — the server is wherever
  // Coolify is — and neither can be matched against a DNS record, so the
  // instance URL stands in for both.
  const namesCoolifysOwnHost =
    serverIp === DOCKER_HOST_ALIAS || isLoopbackAddress(serverIp);

  if (serverIp && !namesCoolifysOwnHost) {
    // Unbracketed first: a bracketed literal fails isIP and would otherwise
    // be handed to the resolver as though it were a hostname, which is the
    // same mistake the instance-URL path already avoids.
    const bare = serverIp.trim().replace(/^\[|\]$/g, "");
    // Checked here rather than folded into the loopback test: loopback means
    // the server is wherever Coolify is, and falls through to the instance
    // URL below. A private address names a different machine entirely, so
    // there is nothing to fall through to.
    if (isNonRoutableAddress(bare) || isDeferredIpv6(bare)) return null;
    return isIP(bare)
      ? { kind: "ip", ip: bare }
      : { kind: "resolve", hostname: bare };
  }
  // No address at all is not the same as naming Coolify's own host: Coolify
  // can omit one, and the picker can hold a server the current list no longer
  // has. Guessing the instance there would fail a correctly pointed domain.
  if (!namesCoolifysOwnHost) return null;

  let host: string;
  try {
    // URL wraps an IPv6 literal in brackets, which is not what isIP accepts.
    host = new URL(instanceUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
  // The same test the reported address gets: a Coolify reached on localhost
  // says nothing about where a public domain should point, and answering with
  // it would produce the one instruction guaranteed to be wrong.
  if (
    !host ||
    isLoopbackAddress(host) ||
    isNonRoutableAddress(host) ||
    isDeferredIpv6(host)
  ) {
    return null;
  }
  if (isIP(host)) return { kind: "ip", ip: host };
  return { kind: "resolve", hostname: host };
}
