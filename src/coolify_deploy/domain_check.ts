import { isIP } from "node:net";

/** What Coolify reports as the address of the machine it runs on. */
const DOCKER_HOST_ALIAS = "host.docker.internal";

/**
 * Whether a value names the machine asking rather than a reachable server.
 *
 * Covers both spellings, because answering with either would have us tell the
 * user to point a public domain at a loopback address.
 */
function isLoopbackAddress(value: string | null | undefined): boolean {
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
  // Nothing to compare against: we know nothing, so we claim nothing.
  if (expectedIps.length === 0) return "unknown";
  if (actualIps.length === 0) return "no-records";
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
  if (!host || isLoopbackAddress(host)) return null;
  if (isIP(host)) return { kind: "ip", ip: host };
  return { kind: "resolve", hostname: host };
}
