/**
 * What went wrong on an SSH attempt, and how to ask about it from anywhere.
 *
 * Separate from the client so that asking costs nothing: telemetry is reached
 * from `main.ts` and from every typed handler, and it only ever needs to know
 * which failure an error carries. The client itself is a large module whose
 * one job is to talk to a server, and nothing on the startup path has any use
 * for that. `connectSsh` loads `ssh2` when it actually connects, which is what
 * keeps it off the boot; this keeps the question askable without reaching for
 * the client at all.
 */
/**
 * Every failure the client reports, and the only source of the type.
 *
 * One list rather than a union beside a lookup: the accessor below has to
 * decide whether a value is one of these at runtime, and a second copy of
 * the members is a copy that can fall behind the first.
 */
export const SSH_FAILURES = [
  "auth-rejected",
  "host-key-rejected",
  "unreachable",
  /** The connection stopped answering: nothing on it will work again. */
  "timeout",
  /**
   * We gave up on one command, having asked it to be quick.
   *
   * Distinct from "timeout" because the connection is still good and the
   * question can be asked again — a caller that polls must be able to tell
   * "this attempt was slow" from "this link is dead", or one slow answer ends
   * a wait that had minutes left in it.
   */
  "command-timeout",
  /**
   * The handshake failed for a reason that is not the key being turned down.
   *
   * Key exchange or host-key algorithms with nothing in common, or a
   * protocol error. Kept apart from "host-key-rejected" because that one
   * says the server may not be the machine it was — which is alarming, and
   * wrong for an old or hardened sshd that simply cannot agree on ciphers.
   */
  "handshake-failed",
  /** Nothing here recognised it. */
  "unknown",
] as const;

export type SshFailure = (typeof SSH_FAILURES)[number];

/**
 * The failure an error carries, or null if it is not one of ours.
 *
 * Matched on the name rather than with `instanceof` so that asking the
 * question costs nothing at load time. `SshError` sets its own `name`, and
 * the failure is one of the values above.
 */
export function sshFailureOf(error: unknown): SshFailure | null {
  if (!(error instanceof Error) || error.name !== "SshError") return null;
  const { failure } = error as Error & { failure?: unknown };
  // Checked, not asserted. The name is all that got us here, and anything
  // may carry it — handing back a value the type says cannot exist would
  // put it past a caller that has covered every case there is.
  return SSH_FAILURES.includes(failure as SshFailure)
    ? (failure as SshFailure)
    : null;
}
