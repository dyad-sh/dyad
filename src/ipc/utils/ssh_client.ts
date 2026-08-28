import type { ClientChannel, ConnectConfig } from "ssh2";
import type { SshFailure } from "@/shared/ssh_failure";
import { createHash } from "crypto";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("ssh_client");

/**
 * Dyad's SSH client, for setting a server up before Coolify exists on it.
 *
 * Deploying needs no SSH at all — Coolify clones from GitHub with a key Dyad
 * hands it. This is the other half: reaching a bare machine to install Coolify
 * in the first place, which nothing else in Dyad does.
 */

/** Long enough for a slow link, short enough that a wrong address gives up. */
const CONNECT_TIMEOUT_MS = 20_000;

export interface SshTarget {
  host: string;
  port?: number;
  username: string;
  /** OpenSSH format. Node's PEM export is rejected by the wire library. */
  privateKey: string;
}

/**
 * What went wrong, from the connection itself rather than from its message.
 *
 * Kept as a closed set because the caller decides what to tell the user from
 * it: a rejected key asks them to check the key is on the server, and an
 * unreachable host asks them to check the address. Reading English out of a
 * message to make that choice breaks the first time the wording moves.
 */
export type { SshFailure };

export class SshError extends DyadError {
  constructor(
    readonly failure: SshFailure,
    message: string,
    kind: DyadErrorKind,
  ) {
    super(message, kind);
    this.name = "SshError";
  }
}

/**
 * The fingerprint OpenSSH would print for the same key.
 *
 * Matching its format matters because the user checks this against something
 * else — their provider's console, or `ssh-keyscan` — and two spellings of the
 * same key read as two different keys.
 */
export function hostKeyFingerprint(key: Buffer): string {
  return (
    "SHA256:" +
    createHash("sha256").update(key).digest("base64").replace(/=+$/, "")
  );
}

/**
 * Decides whether to trust the server presenting this key.
 *
 * A parameter rather than a policy baked in here, because the answer differs by
 * how we arrived. A server the user typed the address of has nothing to check
 * against, so the honest answer is to show them the fingerprint. One Dyad has
 * already looked at can be checked exactly.
 *
 * Synchronous: ssh2 decides during the handshake, with nothing to await into,
 * so anything that needs asking is answered before connecting.
 */
export type HostKeyVerifier = (fingerprint: string) => boolean;

/** Accepts any host, reporting the fingerprint. Trust on first use. */
export function trustOnFirstUse(
  onSeen: (fingerprint: string) => void,
): HostKeyVerifier {
  return (fingerprint) => {
    onSeen(fingerprint);
    return true;
  };
}

/** Accepts only the fingerprint a provider already told us to expect. */
export function expectFingerprint(expected: string): HostKeyVerifier {
  return (fingerprint) => fingerprint === expected;
}

function classify(
  err: NodeJS.ErrnoException & { level?: string },
  { connected = false }: { connected?: boolean } = {},
): SshError {
  const level = err.level ?? "";
  if (level === "client-authentication") {
    return new SshError(
      "auth-rejected",
      "The server refused this key. Add Dyad's public key to the server's " +
        "authorized_keys and try again.",
      DyadErrorKind.Auth,
    );
  }
  if (level === "handshake") {
    return new SshError(
      "host-key-rejected",
      "The server presented a different host key than the one expected.",
      DyadErrorKind.Precondition,
    );
  }
  if (level === "client-timeout") {
    return new SshError(
      "timeout",
      connected
        ? "The server stopped answering. It may have run out of memory or " +
            "frozen; check it and try again."
        : "The server did not answer in time. Check the address and that " +
            "port 22 is reachable.",
      DyadErrorKind.External,
    );
  }
  if (
    err.code === "ENOTFOUND" ||
    err.code === "ECONNREFUSED" ||
    err.code === "EHOSTUNREACH"
  ) {
    return new SshError(
      "unreachable",
      `Could not reach the server (${err.code}). Check the address and that ` +
        `port 22 is open.`,
      DyadErrorKind.External,
    );
  }
  return new SshError(
    "unknown",
    connected
      ? `The connection to the server failed: ${err.message}`
      : `Could not connect over SSH: ${err.message}`,
    DyadErrorKind.External,
  );
}

export interface SshResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface SshSession {
  /**
   * Runs a command, optionally feeding it on stdin.
   *
   * Input goes to stdin rather than into the command line because everything
   * interesting here is a script, and a script on a command line has to survive
   * a shell — quoting that is where this kind of code goes wrong.
   */
  run(
    command: string,
    options?: {
      input?: string;
      onOutput?: (chunk: string) => void;
      signal?: AbortSignal;
      /**
       * How long to wait for this command, in milliseconds.
       *
       * Unbounded by default, because an installer legitimately runs for
       * minutes with nothing to say. Anything with a shorter honest answer —
       * a probe, a tinker one-liner — should give one: without it, a server
       * whose docker has wedged leaves the step it is on hanging forever, and
       * the user has to work out for themselves that nothing is happening.
       */
      timeoutMs?: number;
    },
  ): Promise<SshResult>;
  end(): void;
}

/**
 * Opens a session, or throws having said which part failed.
 *
 * The verifier runs before anything is sent, so a server that fails it never
 * receives the credentials for the account being set up.
 */
export async function connectSsh(
  target: SshTarget,
  verifyHostKey: HostKeyVerifier,
  { signal }: { signal?: AbortSignal } = {},
): Promise<SshSession> {
  // Loaded when someone actually connects, not when this module is imported.
  // The setup handlers are registered during boot, so a value import here put
  // ssh2 — and the optional native probe it runs on load — on the startup of
  // every app, whether or not anyone ever set a server up. That also turned a
  // packaging miss into a process that does not start, rather than one
  // feature that does not work.
  const { Client } = await import("ssh2");
  const conn = new Client();
  /**
   * Why the connection died, for commands that were in flight when it did.
   *
   * The keepalive above turns a frozen peer into a torn-down socket, which
   * closes any open channel with no exit code — and a command that reads that
   * as an ordinary finish reports the connection's death as the installer's
   * verdict. Kept here so the command can say what actually happened.
   */
  let connectionError: SshError | null = null;
  /** Whether the handshake got through, which changes what advice fits. */
  let ready = false;
  let rejectedHostKey = false;

  // Registered before the handshake is awaited, not after: an error arriving
  // in the same tick as "ready" would otherwise have nothing listening. The
  // promise's own listener still owns rejecting while it is pending; this one
  // only remembers, and keeps an unhandled 'error' on a Client — which would
  // take the process down — from ever being unhandled.
  conn.on("error", (err) => {
    connectionError = classify(
      err as NodeJS.ErrnoException & { level?: string },
      // Anything reaching here after the handshake is a session that was
      // working and stopped, so the advice is about the machine rather than
      // about the address that was typed.
      { connected: ready },
    );
  });

  await new Promise<void>((resolve, reject) => {
    // Reaching an address that is firewalled takes as long as the handshake
    // timeout allows, and until this landed Cancel did nothing at all for
    // that whole stretch — the panel said "Stopping…" and kept going.
    if (signal?.aborted) {
      conn.end();
      reject(new DyadError("Cancelled.", DyadErrorKind.UserCancelled));
      return;
    }
    const onAbort = () => {
      conn.end();
      reject(new DyadError("Cancelled.", DyadErrorKind.UserCancelled));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const settled = (fn: () => void) => () => {
      signal?.removeEventListener("abort", onAbort);
      fn();
    };
    conn.on(
      "ready",
      settled(() => {
        ready = true;
        resolve();
      }),
    );
    conn.on("error", (rawError) => {
      signal?.removeEventListener("abort", onAbort);
      const err = rawError;
      // A host key the verifier turned down surfaces as a handshake failure,
      // which is also what a genuinely mismatched key looks like. Saying which
      // it was matters: one is the user declining, the other is a warning.
      if (rejectedHostKey) {
        reject(
          new SshError(
            "host-key-rejected",
            "The server's identity was not accepted, so nothing was sent to it.",
            DyadErrorKind.UserCancelled,
          ),
        );
        return;
      }
      reject(classify(err as NodeJS.ErrnoException & { level?: string }));
    });

    const config: ConnectConfig = {
      host: target.host,
      port: target.port ?? 22,
      username: target.username,
      privateKey: target.privateKey,
      readyTimeout: CONNECT_TIMEOUT_MS,
      // Only the handshake is bounded by readyTimeout. Without a keepalive
      // nothing notices a peer that still answers TCP but has stopped
      // answering SSH — a frozen box — and a command sent to it never
      // settles, taking the whole setup with it.
      keepaliveInterval: 15_000,
      hostVerifier: (key: Buffer) => {
        const accepted = verifyHostKey(hostKeyFingerprint(key));
        if (!accepted) rejectedHostKey = true;
        return accepted;
      },
    };
    conn.connect(config);
  });

  return {
    run(command, { input, onOutput, signal, timeoutMs } = {}) {
      return new Promise<SshResult>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DyadError("Cancelled.", DyadErrorKind.UserCancelled));
          return;
        }
        let timer: ReturnType<typeof setTimeout> | undefined;
        // Wired before the channel is asked for, not inside the callback
        // that answers. Opening a channel takes a round trip, and on a server
        // that has stopped answering that callback never runs — so a listener
        // attached there would never exist, and Cancel would do nothing at
        // all for as long as the command was outstanding.
        let openStream: ClientChannel | null = null;
        let cancelled = false;
        const onAbort = () => {
          cancelled = true;
          stopListening();
          openStream?.close();
          reject(new DyadError("Cancelled.", DyadErrorKind.UserCancelled));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        const stopListening = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        };

        if (timeoutMs !== undefined) {
          timer = setTimeout(() => {
            // The channel is closed as well as the promise settled: giving up
            // on an answer is not the same as stopping the work, and a
            // command left running holds its channel open until the whole
            // session ends.
            cancelled = true;
            openStream?.close();
            signal?.removeEventListener("abort", onAbort);
            reject(
              new SshError(
                "command-timeout",
                "The server did not answer in time.",
                DyadErrorKind.External,
              ),
            );
          }, timeoutMs);
        }

        const askForChannel = () =>
          conn.exec(command, (err, stream) => {
            if (err) {
              stopListening();
              // The latched reason first, as everywhere else: when the
              // connection died, that is what went wrong, and the channel
              // error is only how it surfaced here.
              reject(
                connectionError ??
                  classify(err as NodeJS.ErrnoException & { level?: string }, {
                    connected: true,
                  }),
              );
              return;
            }
            let stdout = "";
            let stderr = "";
            openStream = stream;
            // The cancel landed while the channel was opening: the listener
            // above has already rejected, so all this has to do is let go of
            // the channel it was handed.
            if (cancelled) {
              stream.close();
              return;
            }

            const failCommand = (error: unknown) => {
              stopListening();
              reject(
                connectionError ??
                  classify(
                    error as NodeJS.ErrnoException & { level?: string },
                    {
                      connected: true,
                    },
                  ),
              );
            };
            // A channel error with nobody listening is thrown, which would end
            // the main process rather than the command.
            stream.on("error", failCommand);
            stream.stderr.on("error", failCommand);

            stream.on("data", (chunk: Buffer) => {
              const text = chunk.toString("utf8");
              stdout += text;
              onOutput?.(text);
            });
            stream.stderr.on("data", (chunk: Buffer) => {
              const text = chunk.toString("utf8");
              stderr += text;
              onOutput?.(text);
            });
            stream.on("close", (code: number | null) => {
              stopListening();
              // Only when the command never said how it ended. A channel
              // closed without an exit status is the connection dying under
              // it, and reporting that as an exit code blames the installer
              // for a lost link — but a command that did report its own
              // result gets to keep it, even if the link died straight after.
              //
              // Loose equality on purpose: ssh2 initialises the exit code to
              // undefined and only assigns it when an exit-status arrives, so
              // "never said" is undefined here rather than null.
              if (connectionError && code == null) {
                reject(connectionError);
                return;
              }
              resolve({ code: code ?? null, stdout, stderr });
            });

            // Every command gets EOF on stdin, so one that reads it sees the
            // end rather than a pipe that stays open for the life of the
            // channel. `eof()` rather than `end()`: ending finishes the write
            // side, and Node destroys a Duplex whose write side is finished as
            // soon as its read side ends — which in ssh2 sends CHANNEL_CLOSE,
            // dropping an exit status still on its way and killing a command
            // still running.
            if (input !== undefined) {
              stream.write(input, () => stream.eof());
            } else {
              stream.eof();
            }
          });

        try {
          askForChannel();
        } catch (error) {
          // ssh2 throws where it stands when the socket is already gone,
          // which would skip the cleanup below and leave the abort listener
          // attached to a signal nobody will ever answer.
          stopListening();
          reject(
            connectionError ??
              classify(error as NodeJS.ErrnoException & { level?: string }, {
                connected: true,
              }),
          );
        }
      });
    },
    end() {
      try {
        conn.end();
      } catch (error) {
        // Closing a connection that already died is not a failure worth
        // raising over whatever actually went wrong first.
        logger.debug("Ignored error while closing SSH session", error);
      }
    },
  };
}
