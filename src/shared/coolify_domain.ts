/**
 * Whether a domain can be handed to Coolify's own configuration.
 *
 * The characters are what makes this narrow rather than the shape: the value
 * ends up inside a script that runs on the user's server, so anything that
 * could end the quoting around it is refused rather than escaped.
 *
 * Lives in shared/ so the panel can say so while the domain is being typed and
 * the code that builds the script can refuse the same thing — that refusal is
 * a guard, and a guard is not a good place to learn you made a typo, since it
 * fires minutes into an install.
 *
 * Free of any Node import, because the renderer imports it.
 */
export function isPlausibleInstanceDomain(value: string): boolean {
  const bare = value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
  if (!bare) return false;
  return /^[A-Za-z0-9.-]+$/.test(bare);
}
