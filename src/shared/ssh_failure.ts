/**
 * What went wrong on an SSH attempt, and how to ask about it from anywhere.
 *
 * Separate from the client because the client value-imports `ssh2`, and the
 * main process reaches this from its startup path: telemetry is pulled in by
 * `main.ts` and by every typed handler, so importing the error class there
 * would put `ssh2` and its optional native probe on the boot of every app,
 * including for people who never open the Coolify panel — and would turn a
 * packaging miss into a process that does not start rather than one feature
 * that does not work.
 */
export type SshFailure =
  | "auth-rejected"
  | "host-key-rejected"
  | "unreachable"
  /** The connection stopped answering: nothing on it will work again. */
  | "timeout"
  /**
   * We gave up on one command, having asked it to be quick.
   *
   * Distinct from "timeout" because the connection is still good and the
   * question can be asked again — a caller that polls must be able to tell
   * "this attempt was slow" from "this link is dead", or one slow answer ends
   * a wait that had minutes left in it.
   */
  | "command-timeout"
  /** Nothing here recognised it. */
  | "unknown";

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
  return typeof failure === "string" ? (failure as SshFailure) : null;
}
