/**
 * Turning a name someone typed into a name Cloudflare will accept.
 *
 * D1 database names allow letters, digits, underscores and hyphens. This is
 * also the name that reaches `wrangler d1 create` as an argument, so it is
 * restricted rather than escaped: the argument array already stops a name
 * becoming a command, and a name that cannot be expressed plainly is one the
 * user should see rejected rather than silently altered beyond recognition.
 */

/** Cloudflare's own ceiling for a D1 database name. */
export const MAX_D1_NAME_LENGTH = 64;

export class InvalidD1NameError extends Error {}

/**
 * A safe name, or a thrown error.
 *
 * Spaces become hyphens and case is preserved, so "Client Work" reads back as
 * "Client-Work" rather than something the user cannot recognise in the
 * Cloudflare dashboard.
 */
export function sanitiseD1DatabaseName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new InvalidD1NameError("Give the database a name.");
  }

  const cleaned = trimmed
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    // Removing characters leaves gaps behind: "db; rm -rf /" would otherwise
    // become "db-rm--rf-", which is not a name anyone would choose.
    .replace(/-{2,}/g, "-");

  if (!cleaned) {
    throw new InvalidD1NameError(
      "That name has no letters or numbers in it. Try something like customers-db.",
    );
  }

  // Cloudflare rejects names that do not start with a letter or digit, and a
  // trailing separator is just untidy.
  const normalised = cleaned.replace(/^[-_]+/, "").replace(/[-_]+$/, "");
  if (!normalised) {
    throw new InvalidD1NameError("A name cannot be only dashes.");
  }

  if (normalised.length > MAX_D1_NAME_LENGTH) {
    throw new InvalidD1NameError(
      `Names can be at most ${MAX_D1_NAME_LENGTH} characters.`,
    );
  }

  return normalised;
}
