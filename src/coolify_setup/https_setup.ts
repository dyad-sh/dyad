import log from "electron-log";
import { isIP } from "node:net";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { sleep } from "./sleep";
import type { SshSession } from "@/ipc/utils/ssh_client";
import { runTinker } from "./tinker";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import { isPlausibleInstanceDomain } from "@/shared/coolify_domain";
import { resolveBoth } from "@/ipc/utils/dns_resolve";
import {
  domainCheckVerdict,
  isLoopbackAddress,
  isNonRoutableAddress,
} from "@/shared/domain_check";

/**
 * Getting the new instance onto HTTPS, if it can be had.
 *
 * A stock Coolify serves plain HTTP, so Dyad's API token — which carries root
 * abilities and can read database connection strings — would cross the network
 * in the clear on every deploy, not just once at setup.
 *
 * Coolify already knows how to fix this: give it a domain and its proxy asks
 * Let's Encrypt for a certificate. The missing piece is the domain, and a
 * server's own address is one: `1.2.3.4.sslip.io` resolves to 1.2.3.4 with
 * nothing to configure.
 *
 * Attempted rather than required. Certificates depend on a third party that can
 * refuse, so this checks whether it worked and puts the instance back on plain
 * HTTP if it did not. Verified against Coolify 4.3.2: a domain that cannot be
 * validated leaves port 8000 serving normally, so the fallback is a real one.
 */

/** Long enough for the proxy to be rebuilt, short enough to give up on. */
const APPLY_DOMAIN_TIMEOUT_MS = 60_000;
/**
 * Shorter, and only when a cancel is waiting on it.
 *
 * The revert ignores the abort signal — it is undoing what the cancel
 * interrupted — so this bounds how long a cancel already waiting is held.
 * A cancel that lands once the revert is under way waits for it: giving up
 * part-way is worse than the delay. Every other exit gets the same budget as
 * the apply, because nobody is being held up.
 */
const CANCELLED_REVERT_TIMEOUT_MS = 10_000;

/** It answered in about fifteen seconds on a new server; this is slack. */
const CERTIFICATE_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 6_000;

/**
 * The name to ask for a certificate for.
 *
 * A hostname the user gave us is already a domain and is the better answer:
 * it is theirs, and it does not spend anyone else's certificate allowance. Only
 * a bare address needs sslip.io, which exists precisely so an address can be
 * spelled as a name.
 */
export function certificateDomainFor(
  host: string,
  customDomain?: string | null,
): string | null {
  const custom = customDomain?.trim();
  if (custom) {
    const bareCustom = custom.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    // The same reasoning as the derived names below, which a domain given by
    // hand needs just as much: nothing public can validate a name only this
    // machine answers to, and asking anyway spends the whole certificate wait
    // on an answer that cannot arrive.
    if (isLoopbackAddress(bareCustom) || /\.local$/i.test(bareCustom)) {
      return null;
    }
    if (isIP(bareCustom) === 4) {
      if (isNonRoutableAddress(bareCustom)) return null;
      // A bare address is not a name any authority will certify, so asking
      // for one spends the whole wait on a refusal. The derived spelling of
      // the same address is a name, and is what the address would have been
      // turned into had it been left out of the domain field.
      return `${bareCustom}.sslip.io`;
    }
    if (isIP(bareCustom) === 6) return null;
    return bareCustom;
  }

  const bare = host.trim();
  if (isIP(bare) === 4) {
    // A certificate authority validates over the public internet, so a name
    // that resolves to a private or loopback address can never be given one.
    // Deriving it anyway meant waiting out the whole certificate poll — two
    // minutes — for an answer that could not arrive, which is what a homelab
    // server on a LAN address would do every time.
    if (isLoopbackAddress(bare) || isNonRoutableAddress(bare)) return null;
    return `${bare}.sslip.io`;
  }
  // A name only this machine or this network answers to is in the same
  // position as a private address: nothing public can validate it, and asking
  // anyway costs the whole certificate wait. mDNS names are spelled out here
  // rather than folded into isLoopbackAddress, which means something narrower
  // — a .local is a real machine, just not one the internet can reach.
  if (isLoopbackAddress(bare) || /\.local$/i.test(bare)) return null;
  // IPv6 has an sslip.io spelling with dashes, but Coolify's proxy and the
  // certificate authority both have more to say about IPv6 than is worth
  // guessing at here. A name is used as given.
  if (isIP(bare) === 6) return null;
  return bare || null;
}

export function httpsUrlFor(domain: string): string {
  return `https://${domain}`;
}

/** Bracketed when it needs to be, or the colons read as a port. */
export function urlHost(host: string): string {
  return isIP(host) === 6 ? `[${host}]` : host;
}

/**
 * Coolify's own port, or the one an e2e build was told to use.
 *
 * Fixed in production because Coolify's installer fixes it. Named by the
 * environment under a test build so parallel workers do not have to share it.
 */
function dashboardPort(): number {
  const override = IS_TEST_BUILD ? process.env.DYAD_E2E_DASHBOARD_PORT : null;
  return override ? Number(override) : 8000;
}

export function plainUrlFor(host: string): string {
  return `http://${urlHost(host)}:${dashboardPort()}`;
}

/**
 * Points Coolify at a domain and reconfigures its proxy.
 *
 * Both halves are needed: the setting alone changes nothing until the proxy is
 * rebuilt, which is what asks for the certificate.
 *
 * WORKAROUND: only the dashboard can set this, so it writes the model field
 * and calls the proxy rebuild the dashboard calls.
 *
 * TODO: replace if Coolify gains an endpoint or command that sets the instance
 * domain and reconfigures the proxy.
 */
export async function applyInstanceDomain(
  session: SshSession,
  domain: string | null,
  {
    signal,
    timeoutMs = APPLY_DOMAIN_TIMEOUT_MS,
  }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<void> {
  if (domain !== null && !isPlausibleInstanceDomain(domain)) {
    throw new DyadError(
      `Refusing to set an unsafe instance domain: ${domain}`,
      DyadErrorKind.Validation,
    );
  }
  const answer = await runTinker(
    session,
    // One statement, so nothing after a throw runs. Tinker carries on to the
    // next line when a statement fails, which for a marker on its own line
    // means the write can fail and still report success — and this marker is
    // what the caller reads to decide the domain went on, or came back off.
    // Server 0 is the machine Coolify runs on, which is the one serving the
    // dashboard this domain points at.
    `echo (function () { $s = \\App\\Models\\InstanceSettings::get(); ` +
      (domain === null
        ? `$s->fqdn = null; `
        : `$s->fqdn = 'https://' . getenv('DYAD_INSTANCE_DOMAIN'); `) +
      // Eloquent answers false rather than throwing when something vetoes
      // the write, so the throw-safety above is not enough on its own.
      `if (!$s->save()) { return 'not-saved'; } ` +
      `\\App\\Models\\Server::find(0)->setupDynamicProxyConfiguration(); ` +
      `return 'applied'; })();`,
    {
      env: domain === null ? {} : { DYAD_INSTANCE_DOMAIN: domain },
      signal,
      // Bounded: the proxy rebuild is the slow part, and a server that never
      // answers leaves "Setting up HTTPS" on screen with nothing behind it.
      timeoutMs,
    },
  );
  // Checked, because a Coolify that refused still prints and still ends. Left
  // unread, its error became a two-minute wait blamed on the certificate
  // authority. Matched loosely: the transcript carries its own noise.
  if (!answer.includes("applied")) {
    throw new DyadError(
      `Coolify would not take the domain: ${answer.trim()}`,
      DyadErrorKind.External,
    );
  }
}

/**
 * Whether the address serves HTTPS with a certificate this machine trusts.
 *
 * Node rejects an untrusted certificate rather than reporting it, so a request
 * that resolves at all is the check. A self-signed certificate would fail here,
 * which is the point: it would fail in the user's browser too.
 */
export async function hasTrustedCertificate(
  url: string,
  { fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return res.status > 0;
  } catch {
    return false;
  }
}

/**
 * Whether a domain the user gave us points at the server being set up.
 *
 * Asked before the domain is applied, because a certificate is not the same
 * question as "is this our server". A name still pointing at the user's old
 * site answers HTTPS on the first poll with a valid certificate of its own,
 * and taking that as success would store that host as Coolify's address — and
 * send it an API token that carries root abilities.
 *
 * Advisory in one direction only: a resolver we could not reach says nothing,
 * so it is not treated as a wrong answer.
 */
export async function domainPointsAtServer(
  domain: string,
  host: string,
  {
    resolve = resolveBoth,
    hostAddresses,
  }: { resolve?: typeof resolveBoth; hostAddresses?: string[] } = {},
): Promise<
  | "points-here"
  | "points-elsewhere"
  | "no-answer"
  | "server-unresolved"
  | "different-families"
> {
  // A server known by a name is resolved to the addresses it stands for, so
  // the domain is compared against the same thing either way. A name that
  // does not resolve leaves nothing to compare, which the verdict below reads
  // as not knowing rather than as a wrong answer.
  const expectedIps =
    isIP(host) !== 0
      ? [host]
      : (hostAddresses ?? (await resolve(host)).addresses);
  const resolved = await resolve(domain);
  // A resolver that could not be reached is not a name with no records. Both
  // arrive with nothing to compare, but only the second is the domain saying
  // where it points — the first is Dyad not having asked successfully, which
  // the caller has to be able to tell apart from an answer.
  if (resolved.failed) return "no-answer";
  const verdict = domainCheckVerdict({
    expectedIps,
    actualIps: resolved.addresses,
  });
  if (verdict === "points-elsewhere") return "points-elsewhere";
  // Two different things arrive as "unknown", and neither is an answer.
  //
  // With addresses on both sides it is records that cannot be compared,
  // because they are in different families. With none on ours it is the
  // server's own name that did not resolve — a name only this machine or
  // this network answers to, which plain DNS cannot see and connectSsh
  // reaches anyway. Accepting there compared a user's domain against
  // nothing at all, which is the whole of what this function is for.
  // Nothing on our side to hold the domain against, whatever the domain
  // turned out to say. domainCheckVerdict answers about the domain first — a
  // name with no records is a fact about it, true whatever the server's
  // address is — so that answer arrives before it ever looks at ours, and
  // reading it as agreement would compare against nothing at all.
  if (expectedIps.length === 0) return "server-unresolved";
  if (verdict === "unknown") {
    // Both sides answered, in families that cannot meet. A different thing
    // from either lookup coming back empty, and a different remedy.
    return "different-families";
  }
  return "points-here";
}

const logger = log.scope("coolify_https_setup");

export interface HttpsOutcome {
  /** What Dyad should store and talk to. */
  instanceUrl: string;
  secure: boolean;
  /** Present when HTTPS was attempted and did not arrive. */
  reason?: string;
}

/**
 * Tries to put the instance on HTTPS, and settles for HTTP if it cannot.
 *
 * The instance is left on plain HTTP rather than pointed at a domain with no
 * certificate: a half-configured proxy would answer the dashboard's own address
 * with an error, and a working server nobody can open is worse than one that is
 * merely unencrypted.
 */
/**
 * Whether a name stands for something a certificate authority could reach.
 *
 * Only a definite private answer says no. A resolver that cannot answer, or a
 * name with no records yet, leaves this true — refusing there would decline
 * HTTPS for a server that could have had it.
 */
function resolvesPublicly(addresses: string[]): boolean {
  if (addresses.length === 0) return true;
  return addresses.some(
    (address) => !isLoopbackAddress(address) && !isNonRoutableAddress(address),
  );
}

export async function tryEnableHttps(
  session: SshSession,
  host: string,
  {
    customDomain,
    signal,
    timeoutMs = CERTIFICATE_TIMEOUT_MS,
    intervalMs = POLL_INTERVAL_MS,
    now = () => Date.now(),
    check = hasTrustedCertificate,
    resolve = resolveBoth,
    onProgress,
  }: {
    customDomain?: string | null;
    signal?: AbortSignal;
    timeoutMs?: number;
    intervalMs?: number;
    now?: () => number;
    check?: typeof hasTrustedCertificate;
    resolve?: typeof resolveBoth;
    onProgress?: (message: string) => void;
  } = {},
): Promise<HttpsOutcome> {
  const domain = certificateDomainFor(host, customDomain);
  if (!domain) {
    return {
      instanceUrl: plainUrlFor(host),
      secure: false,
      // Says which of the two was refused. Blaming the address for a domain
      // the user typed sends them to check the thing that was fine.
      reason: customDomain?.trim()
        ? `${customDomain.trim()} cannot be given a certificate, because ` +
          `nothing on the public internet can reach it to check.`
        : "This address cannot be given a certificate.",
    };
  }

  // A name is only as reachable as what it stands for. Asked before the
  // domain is applied, because a server on a LAN address would otherwise
  // apply it, rebuild the proxy, wait out the whole certificate poll for an
  // answer that cannot come, and take it all back off again.
  const hostAddresses =
    isIP(host) === 0 ? (await resolve(host)).addresses : [host];
  if (!resolvesPublicly(hostAddresses)) {
    return {
      instanceUrl: plainUrlFor(host),
      secure: false,
      reason: `${host} resolves to an address the public internet cannot reach, so no certificate can be issued for it.`,
    };
  }

  // Only a domain of the user's own can point somewhere else. A derived
  // sslip.io name resolves to the address it was built from, by construction
  // — including one derived from an address typed into the domain field,
  // which is why this asks what the domain turned out to be rather than
  // whether the field was filled. An address typed there that is not this
  // server is still the user's own, and is still checked.
  if (customDomain && domain !== `${host}.sslip.io`) {
    const points = await domainPointsAtServer(domain, host, {
      resolve,
      hostAddresses,
    });
    if (points === "points-elsewhere") {
      return {
        instanceUrl: plainUrlFor(host),
        secure: false,
        reason:
          `${domain} does not point at this server, so a certificate for it ` +
          `would not describe this machine. Point it at ${host} and set the ` +
          `domain in Coolify.`,
      };
    }
    // Not knowing is not permission. The certificate poll below settles for
    // any address that answers with a certificate it trusts, and it resolves
    // the name through the system rather than the resolver asked here — so a
    // domain still pointing at a machine the user is moving off would be
    // taken as proof, and its address stored as the instance to send the API
    // token to on every deploy.
    if (points === "no-answer") {
      return {
        instanceUrl: plainUrlFor(host),
        secure: false,
        reason:
          `Dyad could not look up where ${domain} points, so it cannot tell ` +
          `whether a certificate for it would describe this machine. Check ` +
          `the domain resolves to ${host} and try again.`,
      };
    }
    // Nothing came back for the server itself, so there is nothing to hold
    // the domain against — which is not the domain's fault and may not be a
    // fault at all: a name only this network answers to is reached over SSH
    // and invisible to plain DNS.
    if (points === "server-unresolved") {
      return {
        instanceUrl: plainUrlFor(host),
        secure: false,
        reason:
          `Dyad could not look up an address for ${host}, so it cannot tell ` +
          `whether ${domain} points at this server. Reach the server by an ` +
          `address or a name DNS can answer for, or set the domain in ` +
          `Coolify yourself.`,
      };
    }
    // Addresses came back for both, with no family in common — so there is
    // nothing to compare, and which side is which varies. Naming a family
    // here, or saying the domain has only those records, would state as fact
    // something never established: one family's lookup can fail while the
    // other answers, and resolveBoth reports that as an answer.
    if (points === "different-families") {
      return {
        instanceUrl: plainUrlFor(host),
        secure: false,
        reason:
          `Dyad could not compare where ${domain} points with ${host}: the ` +
          `addresses it has for them are in different families, so neither ` +
          `says anything about the other. Give the server's address in the ` +
          `same family as the domain's records, or set the domain in ` +
          `Coolify yourself.`,
      };
    }
  }

  const url = httpsUrlFor(domain);
  onProgress?.(`Requesting a certificate for ${domain}…\n`);

  // True only when the domain earned its place. Every other way out of the
  // block below — no certificate, a cancel, a failure part-way through
  // applying it — leaves Coolify answering at a name that serves nothing, so
  // the domain comes back off before anyone is told what happened.
  let keepDomain = false;
  let settled: HttpsOutcome | null = null;
  // Held so the revert below can add to whatever is on its way out. A cancel
  // leaves by throwing, and its message is all the panel keeps.
  let thrown: unknown;
  try {
    await applyInstanceDomain(session, domain, { signal });

    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      if (signal?.aborted) {
        throw new DyadError("Cancelled.", DyadErrorKind.UserCancelled);
      }
      if (await check(url)) {
        keepDomain = true;
        onProgress?.(`Coolify is available over HTTPS at ${url}\n`);
        return { instanceUrl: url, secure: true };
      }
      await sleep(intervalMs, signal);
    }

    onProgress?.("No certificate arrived; leaving Coolify on plain HTTP.\n");
    // Held rather than returned outright so the revert below can add to it.
    // The caller has this object, not a copy of it.
    settled = {
      instanceUrl: plainUrlFor(host),
      secure: false,
      reason: !domain.endsWith(".sslip.io")
        ? `No certificate was issued for ${domain}. Check that it points at this server.`
        : `No certificate was issued for ${domain}. The free service that ` +
          `provides these names shares one certificate allowance between ` +
          `everyone using it, and it can run out.`,
    };
    return settled;
  } catch (error) {
    thrown = error;
    throw error;
  } finally {
    // Without the signal, which by this point may be the reason we are here.
    // Bounded by the tinker call's own timeout, so a wedged server cannot
    // hold the cancel open.
    if (!keepDomain) {
      // Said out loud: this is the one stretch where the panel has nothing
      // behind it, and on a slow server a silent wait reads as a hang.
      onProgress?.("Removing the temporary domain…\n");
      // Not raced against the signal. A cancel landing mid-revert waits for
      // it, because abandoning a proxy rebuild half-way leaves Coolify
      // answering at a name with no certificate — which is the state this
      // whole block exists to avoid.
      await applyInstanceDomain(session, null, {
        timeoutMs: signal?.aborted
          ? CANCELLED_REVERT_TIMEOUT_MS
          : APPLY_DOMAIN_TIMEOUT_MS,
      }).catch((error: unknown) => {
        // The state the comment above calls the one to avoid, arrived at
        // anyway. Swallowed, because the install itself stands and this is
        // the way out of a failure rather than the failure — but not
        // silently: the last thing the log said was that the domain was
        // being removed, which reads as it having worked.
        logger.error(`Could not remove the temporary domain ${domain}`, error);
        onProgress?.(
          `Could not remove the temporary domain ${domain}. Coolify may ` +
            `still be set to answer at it.\n`,
        );
        // A cancel leaves this way, and the panel shows nothing for a
        // cancelled run — so without this the one thing the user has to act
        // on would be said only into a log nobody is shown.
        if (thrown instanceof Error) {
          (thrown as Error & { warning?: string }).warning =
            `Coolify may still be configured for ${domain}; clear the ` +
            `instance domain in its settings if the dashboard does not ` +
            `answer at ${plainUrlFor(host)}.`;
        }
        if (settled) {
          // Wrapped, so the trim applies to the joined sentence rather than
          // binding to the last piece of it.
          settled.reason = (
            `${settled.reason ?? ""} Coolify may still be configured for ` +
            `${domain}; clear the instance domain in its settings if the ` +
            `dashboard does not answer at ${plainUrlFor(host)}.`
          ).trimStart();
        }
      });
    }
  }
}
