/**
 * Deciding what to do when a managed local server's port is already taken.
 *
 * Meta Human OS runs several local servers as child processes — Helix's Next
 * dev server, OpenWorker's Python agent server. `before-quit` only fires on a
 * graceful exit, so a crash or a force-quit leaves one of them listening, and
 * every later start then dies with EADDRINUSE. A busy port is the normal
 * aftermath of a crash, not an exceptional case, so it needs a decision rather
 * than an error.
 */

export type ServerStartAction =
  /** A healthy server already answers there — use it instead of spawning. */
  | "adopt"
  /** Our own server from a previous run is stuck; stop it and start again. */
  | "reclaim"
  /** The port is free. */
  | "spawn"
  /** Something we do not own holds the port; the user has to decide. */
  | "blocked";

export function decideStartAction(facts: {
  /** Something is listening on the port. */
  portBusy: boolean;
  /** That listener answered our health check as the server we expect. */
  healthy: boolean;
  /** The PID recorded when we last spawned this server is still alive. */
  ownedPidAlive: boolean;
}): ServerStartAction {
  if (!facts.portBusy) return "spawn";
  // A working server is a working server, whoever started it. Adopting is what
  // makes a restart instant instead of a failure.
  if (facts.healthy) return "adopt";
  if (facts.ownedPidAlive) return "reclaim";
  return "blocked";
}

/**
 * The message shown when a stranger holds the port. It has to say what to do,
 * and it must not leak anything but the server's name and port.
 */
export function blockedPortMessage(name: string, port: number): string {
  return (
    `Port ${port} is held by a program that is not responding, so ${name} ` +
    `cannot start. This is usually a ${name} server left behind by an earlier ` +
    `session that Meta Human OS did not start and so will not stop on its ` +
    `own. Close whatever is listening on port ${port}, then try again.`
  );
}
