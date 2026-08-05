import { isIP } from "node:net";

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
 * machine, so it stands in when the reported value is not an address.
 */
export function expectedServerAddress({
  serverIp,
  instanceUrl,
}: {
  serverIp: string | null | undefined;
  instanceUrl: string;
}): { kind: "ip"; ip: string } | { kind: "resolve"; hostname: string } | null {
  if (serverIp && isIP(serverIp)) return { kind: "ip", ip: serverIp };
  let host: string;
  try {
    // URL wraps an IPv6 literal in brackets, which is not what isIP accepts.
    host = new URL(instanceUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
  if (!host) return null;
  if (isIP(host)) return { kind: "ip", ip: host };
  return { kind: "resolve", hostname: host };
}
