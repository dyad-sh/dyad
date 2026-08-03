/**
 * Every scope the integration needs, in the order Coolify's token form lists
 * them.
 *
 * Lives in shared/ so the setup instructions in the renderer and the 403
 * message in the main process cannot drift apart: Coolify fixes a token's
 * scopes when it is created, so a token missing one has to be recreated.
 */
export const COOLIFY_REQUIRED_SCOPES = "read, read:sensitive, write, deploy";
