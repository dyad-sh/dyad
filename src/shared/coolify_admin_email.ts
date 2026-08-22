/**
 * Whether Coolify will accept an address for the admin account it seeds.
 *
 * Lives in shared/ so the panel can warn while the user is still typing and
 * the handler can refuse before it starts, without the two drifting apart.
 * Getting it wrong is expensive in a way most validation is not: Coolify checks
 * this when it seeds the account, minutes into an install, and a rejected
 * address leaves a finished install with no account on it.
 *
 * Kept free of any Node import for the same reason — the renderer imports it,
 * and a `crypto` import here would take the whole window down with it.
 */
export function isPlausibleAdminEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return false;
  // The address is sent to the server inside a quoted shell word, and
  // buildInstallCommand refuses anything that could end that quoting. Said
  // here too, so it is said while the address is being typed rather than
  // after Dyad has connected and looked the server over.
  if (/['"\\`$\n\r#!]/.test(trimmed)) return false;
  // One trailing dot is a legal way to write an absolute name, and Coolify
  // resolves the same domain either way — so it is removed before the checks
  // below rather than letting `dyad.test.` past the reserved list.
  const domain = trimmed
    .slice(trimmed.lastIndexOf("@") + 1)
    .toLowerCase()
    .replace(/\.$/, "");
  // Every label has to be a label. `foo..com` and `.com` are not addresses
  // Coolify will accept, and finding that out costs the whole install. Said
  // as "not empty" rather than as an alphabet, so an internationalised domain
  // is left alone.
  if (!/^[^\s.@]+(\.[^\s.@]+)+$/.test(domain)) return false;
  // Reserved by RFC 2606 and RFC 6761 for testing and documentation, so none
  // of them resolve and none of them can ever be accepted.
  const reserved = ["test", "example", "invalid", "localhost", "local"];
  const lastLabel = domain.slice(domain.lastIndexOf(".") + 1);
  if (reserved.includes(lastLabel)) return false;
  const documentation = ["example.com", "example.net", "example.org"];
  return !documentation.some((d) => domain === d || domain.endsWith(`.${d}`));
}
