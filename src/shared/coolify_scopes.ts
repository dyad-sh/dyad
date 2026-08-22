/**
 * Every scope the integration needs, in the order Coolify's token form lists
 * them.
 *
 * Lives in shared/ so the setup instructions in the renderer, the 403 message
 * in the main process, and the token Dyad mints for itself cannot drift apart:
 * Coolify fixes a token's scopes when it is created, so a token missing one
 * has to be recreated.
 *
 * `read:sensitive` earns its place — Coolify hides a deployment's `logs` and an
 * application's `private_key_id` without it, and the deploy path reads both.
 * `root` is not here: Coolify treats that as a bypass of the ability check
 * rather than as a set of abilities, and no route asks for it.
 */
export const COOLIFY_SCOPES = [
  "read",
  "read:sensitive",
  "write",
  "deploy",
] as const;

export const COOLIFY_REQUIRED_SCOPES = COOLIFY_SCOPES.join(", ");

/** The same list as the PHP array literal the tinker script needs. */
export const COOLIFY_SCOPES_PHP_ARRAY = `[${COOLIFY_SCOPES.map(
  (scope) => `'${scope}'`,
).join(", ")}]`;
