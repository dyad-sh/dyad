import * as dns from "node:dns/promises";

/**
 * Asking DNS where a name points, without mistaking silence for an answer.
 *
 * Shared because two callers need the same distinction: the app-domain check
 * the user runs before saving, and the instance domain Dyad points Coolify at
 * during setup. Both are advisory, and both are wrong in the same expensive
 * way if a resolver that could not be reached reads as "no such record".
 */

/** A resolver saying "no such record" — anything else is our problem, not DNS's. */
const NO_RECORD_CODES = new Set(["ENOTFOUND", "ENODATA", "NOTFOUND"]);

/**
 * Bounded, because Save waits on it.
 *
 * The check is advisory, so a resolver that never answers must not be able to
 * hold the button indefinitely. The bound is per attempt per configured
 * nameserver, so the wait scales with how many the machine has: six seconds
 * against a single stub resolver, and proportionally more where several are
 * listed. Two tries rather than the default four keeps that multiple small. A
 * timeout still arrives as an error code the caller reads as "could not ask"
 * rather than as a missing record.
 */
const resolver = new dns.Resolver({ timeout: 3_000, tries: 2 });

/**
 * Both families, distinguishing "no record" from "could not ask".
 *
 * A timeout or an unreachable resolver must not be reported as a missing
 * record: telling someone to fix DNS that is already correct is exactly the
 * confident-but-wrong advice the unknown verdict exists to avoid.
 */
export async function resolveBoth(
  hostname: string,
): Promise<{ addresses: string[]; failed: boolean }> {
  const attempt = async (fn: (h: string) => Promise<string[]>) => {
    try {
      return { addresses: await fn(hostname), failed: false };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      return { addresses: [] as string[], failed: !NO_RECORD_CODES.has(code) };
    }
  };
  const [v4, v6] = await Promise.all([
    attempt((h) => resolver.resolve4(h)),
    attempt((h) => resolver.resolve6(h)),
  ]);
  return {
    addresses: [...v4.addresses, ...v6.addresses],
    // One family answering is enough. But a definitive "no such record" from
    // one and a failed lookup from the other is not the same as no records:
    // the family we could not reach may hold the one that works.
    failed:
      v4.addresses.length === 0 &&
      v6.addresses.length === 0 &&
      (v4.failed || v6.failed),
  };
}
