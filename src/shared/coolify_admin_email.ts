const UNDELIVERABLE =
  "Use an email address you can receive mail at. Coolify checks that the " +
  "domain resolves when it creates the admin account.";

const UNSENDABLE =
  "Dyad can't send an address containing quotes, backslashes or ` $ # ! to " +
  "the server. Try one without them.";

/**
 * Why this address cannot be the admin account, in words for the person who
 * typed it, or null where it can. Not always Coolify's answer: one of the two
 * rules below is Dyad's own limit, and an address it refuses may be one
 * Coolify would have taken.
 *
 * Lives in shared/ so the panel can warn while the user is still typing and
 * the handler can refuse before it starts, without the two drifting apart.
 * Getting the domain wrong is expensive in a way most validation is not:
 * Coolify checks it when it seeds the account, minutes into an install, and a
 * rejected address leaves a finished install with no account on it.
 *
 * Two different rules refuse an address here and they are not the same news.
 * One is about where mail goes; the other is about what Dyad can put in a
 * shell command. Saying the first for both told someone whose address does
 * work that they could not receive mail at it, which is not true and leaves
 * them nothing to change.
 *
 * Kept free of any Node import — the renderer imports this, and a `crypto`
 * import here would take the whole window down with it.
 */
export function adminEmailRefusal(email: string): string | null {
  const trimmed = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return UNDELIVERABLE;
  // The address goes to the server inside a quoted shell word and from there
  // into a .env file, and buildInstallScript refuses every character that
  // could break either — so the set is wider than the quoting alone would
  // need. Said here too, so it is said while the address is being typed
  // rather than after Dyad has connected and looked the server over.
  //
  // Some of these are legal in a local part, so this is Dyad's limit rather
  // than the address being wrong — and it says so, because telling someone
  // their working address is undeliverable sends them to fix the wrong thing.
  if (/['"\\`$\n\r#!]/.test(trimmed)) return UNSENDABLE;
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
  if (!/^[^\s.@]+(\.[^\s.@]+)+$/.test(domain)) return UNDELIVERABLE;
  // Reserved by RFC 2606 and RFC 6761 for testing and documentation, so none
  // of them resolve and none of them can ever be accepted.
  const reserved = ["test", "example", "invalid", "localhost", "local"];
  const lastLabel = domain.slice(domain.lastIndexOf(".") + 1);
  if (reserved.includes(lastLabel)) return UNDELIVERABLE;
  const documentation = ["example.com", "example.net", "example.org"];
  return documentation.some((d) => domain === d || domain.endsWith(`.${d}`))
    ? UNDELIVERABLE
    : null;
}
