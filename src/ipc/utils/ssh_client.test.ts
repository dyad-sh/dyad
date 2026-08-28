import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";

const h = vi.hoisted(() => {
  /** A real ed25519 host key, so the fingerprint below is a golden value. */
  const HOST_KEY_B64 =
    "AAAAC3NzaC1lZDI1NTE5AAAAIJiGrEZTbNIEO9U84zpD4H6mNsXVcl4il3RsnZ4MQImg";
  return {
    clients: [] as FakeClientShape[],
    HOST_KEY_B64,
    // Scripted here rather than on the target, because connectSsh builds the
    // library's config from named fields and would drop anything extra.
    nextFailure: null as unknown,
  };
});

interface FakeStreamShape extends EventEmitter {
  stderr: EventEmitter;
  written: string | null;
  closed: boolean;
  write(data: string, cb?: () => void): void;
  eof(): void;
  end(data?: string): void;
  close(): void;
}

interface FakeClientShape extends EventEmitter {
  connectConfig: Record<string, unknown> | null;
  execHandler:
    | ((command: string, cb: (err: unknown, stream: unknown) => void) => void)
    | null;
  ended: boolean;
}

/**
 * Stands in for ssh2's Client.
 *
 * Scripted rather than a real server: what this file checks is how the wrapper
 * reads the library's own signals, and those are values the library hands over
 * rather than behaviour a server produces. The values themselves were captured
 * from a live box — see the failure table below.
 */
vi.mock("ssh2", () => {
  const { EventEmitter: EE } = require("events");
  class FakeClient extends EE {
    connectConfig: Record<string, unknown> | null = null;
    execHandler:
      | ((command: string, cb: (err: unknown, stream: unknown) => void) => void)
      | null = null;
    ended = false;

    connect(config: Record<string, unknown>) {
      this.connectConfig = config;
      h.clients.push(this as unknown as FakeClientShape);
      const verifier = config.hostVerifier as
        | ((key: Buffer) => boolean)
        | undefined;
      queueMicrotask(() => {
        // The verifier runs during the handshake, before anything is sent.
        if (verifier && !verifier(Buffer.from(h.HOST_KEY_B64, "base64"))) {
          this.emit(
            "error",
            Object.assign(new Error("Host denied"), { level: "handshake" }),
          );
          return;
        }
        if (h.nextFailure) {
          this.emit("error", h.nextFailure);
          return;
        }
        this.emit("ready");
      });
    }

    exec(command: string, cb: (err: unknown, stream: unknown) => void) {
      this.execHandler?.(command, cb);
    }

    end() {
      this.ended = true;
    }
  }
  return { Client: FakeClient };
});

const HOST_KEY_FINGERPRINT =
  "SHA256:3FQS9D0B0DVizoYtw1hNV09EClubwWqRUXoFnRTu6nA";

import {
  connectSsh,
  hostKeyFingerprint,
  trustOnFirstUse,
  expectFingerprint,
} from "./ssh_client";
import type { SshError } from "./ssh_client";

const TARGET = { host: "203.0.113.5", username: "root", privateKey: "KEY" };

beforeEach(() => {
  h.clients.length = 0;
  h.nextFailure = null;
});

describe("hostKeyFingerprint", () => {
  it("prints what ssh-keygen prints for the same key", () => {
    // Golden pair captured from a live server, so this compares against
    // OpenSSH rather than against a second run of our own arithmetic. The user
    // reads this string next to their provider's console; two spellings of one
    // key would read as two keys.
    expect(hostKeyFingerprint(Buffer.from(h.HOST_KEY_B64, "base64"))).toBe(
      HOST_KEY_FINGERPRINT,
    );
  });
});

describe("connecting", () => {
  it("reports the fingerprint before trusting the server", async () => {
    let seen: string | null = null;
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse((fp) => (seen = fp)),
    );
    expect(seen).toBe(HOST_KEY_FINGERPRINT);
    session.end();
  });

  it("connects when the fingerprint is the one a provider promised", async () => {
    const session = await connectSsh(
      TARGET,
      expectFingerprint(HOST_KEY_FINGERPRINT),
    );
    expect(h.clients[0].connectConfig?.host).toBe("203.0.113.5");
    session.end();
  });

  it("refuses a server whose key is not the promised one", async () => {
    await expect(
      connectSsh(TARGET, expectFingerprint("SHA256:something-else")),
    ).rejects.toMatchObject({ failure: "host-key-rejected" });
  });

  it("calls a declined key the user's decision, not a warning", async () => {
    // Both arrive as a handshake failure, but only one of them means the
    // server's identity changed. Reporting a decline as a mismatch would tell
    // someone their machine was tampered with because they clicked no.
    const error = (await connectSsh(TARGET, () => false).catch(
      (e) => e,
    )) as SshError;
    expect(error.failure).toBe("host-key-rejected");
    expect((error as unknown as { kind: string }).kind).toBe("user_cancelled");
  });
});

/**
 * The five shapes a connection fails in, with the level and code the library
 * actually produced for each against a real server.
 */
describe("classifying a failed connection", () => {
  const CASES: Array<{
    name: string;
    raw: Record<string, unknown>;
    failure: string;
    kind: string;
  }> = [
    {
      name: "a key the server will not take",
      raw: {
        level: "client-authentication",
        message: "All configured authentication methods failed",
      },
      failure: "auth-rejected",
      kind: "auth",
    },
    {
      name: "a host that never answers",
      raw: {
        level: "client-timeout",
        message: "Timed out while waiting for handshake",
      },
      failure: "timeout",
      kind: "external",
    },
    {
      name: "a name that does not resolve",
      raw: {
        level: "client-socket",
        code: "ENOTFOUND",
        message: "getaddrinfo ENOTFOUND nope.invalid",
      },
      failure: "unreachable",
      kind: "external",
    },
    {
      name: "a closed port",
      raw: {
        level: "client-socket",
        code: "ECONNREFUSED",
        message: "connect ECONNREFUSED",
      },
      failure: "unreachable",
      kind: "external",
    },
    {
      name: "two ends that cannot agree on ciphers",
      raw: {
        level: "handshake",
        message: "Handshake failed: no matching key exchange algorithm",
      },
      failure: "handshake-failed",
      kind: "external",
    },
    {
      name: "anything else",
      raw: { level: "client-socket", message: "kernel exploded" },
      failure: "unknown",
      kind: "external",
    },
  ];

  it("does not call a failed negotiation a changed identity", async () => {
    // The key being turned down is answered before this is reached, where
    // the verifier said no. What is left is an old or hardened sshd with no
    // algorithm in common — and telling that user their machine may have
    // been swapped is a false alarm about the one thing this checks for.
    h.nextFailure = Object.assign(
      new Error("Handshake failed: no matching host key format"),
      { level: "handshake" },
    );
    const error = (await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    ).catch((e) => e)) as SshError;

    expect(error.failure).not.toBe("host-key-rejected");
    expect(error.message).not.toMatch(/different host key/);
    expect(error.message).toMatch(/could not agree on how to connect/);
    // What the server said, so the real cause is not lost.
    expect(error.message).toMatch(/no matching host key format/);
  });

  it.each(CASES)("reads $name as $failure", async ({ raw, failure, kind }) => {
    h.nextFailure = Object.assign(new Error(String(raw.message)), raw);
    const error = (await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    ).catch((e) => e)) as SshError;
    expect(error.failure).toBe(failure);
    expect((error as unknown as { kind: string }).kind).toBe(kind);
  });
});

describe("running a command", () => {
  function scriptStream(
    client: FakeClientShape,
    script: (stream: FakeStream) => void,
  ) {
    client.execHandler = (_command, cb) => {
      const stream = new FakeStream();
      cb(null, stream);
      script(stream);
    };
  }

  class FakeStream extends EventEmitter implements FakeStreamShape {
    stderr = new EventEmitter();
    written: string | null = null;
    eofSent = false;
    ended = false;
    closed = false;
    write(data: string, cb?: () => void) {
      this.written = (this.written ?? "") + data;
      cb?.();
    }
    eof() {
      this.eofSent = true;
    }
    end(data?: string) {
      this.written = data ?? null;
      this.ended = true;
    }
    close() {
      this.closed = true;
    }
  }

  it("sends EOF on stdin without finishing the write side", async () => {
    // Both halves matter. Without the EOF, a command that reads stdin waits
    // for a line that is never coming. With `end()` instead, Node destroys
    // the channel as soon as the server sends its own EOF, which loses the
    // exit status and, against a real sshd, kills a command still running.
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    let stream!: FakeStream;
    scriptStream(h.clients[0], (s) => {
      stream = s;
      queueMicrotask(() => s.emit("close", 0));
    });

    await session.run("uname -a");

    expect(stream.eofSent).toBe(true);
    expect(stream.ended).toBe(false);
    expect(stream.written).toBeNull();
  });

  it("hands input to stdin rather than the command line", async () => {
    // Everything this runs remotely is a script, and a script on a command
    // line has to survive a shell. Feeding stdin removes that layer entirely.
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    let stream!: FakeStreamShape;
    scriptStream(h.clients[0], (s) => {
      stream = s;
      queueMicrotask(() => s.emit("close", 0));
    });

    await session.run("cat", { input: "$(rm -rf /) 'quoted'\n" });

    expect(stream.written).toBe("$(rm -rf /) 'quoted'\n");
  });

  it("reports output as it arrives, not only at the end", async () => {
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    scriptStream(h.clients[0], (s) => {
      s.emit("data", Buffer.from("first\n"));
      s.stderr.emit("data", Buffer.from("warning\n"));
      s.emit("data", Buffer.from("second\n"));
      queueMicrotask(() => s.emit("close", 0));
    });

    const chunks: string[] = [];
    const result = await session.run("build", {
      onOutput: (c) => chunks.push(c),
    });

    expect(chunks).toEqual(["first\n", "warning\n", "second\n"]);
    expect(result.stdout).toBe("first\nsecond\n");
    expect(result.stderr).toBe("warning\n");
    expect(result.code).toBe(0);
  });

  it("stops when cancelled mid-run", async () => {
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    let stream!: FakeStreamShape;
    scriptStream(h.clients[0], (s) => {
      stream = s;
    });
    const controller = new AbortController();

    const running = session.run("long-install", { signal: controller.signal });
    controller.abort();

    await expect(running).rejects.toMatchObject({ kind: "user_cancelled" });
    expect(stream.closed).toBe(true);
  });

  it("stops when the server never opens the channel", async () => {
    // A frozen box still answers TCP but stops answering SSH, so the callback
    // that hands over the stream never runs. A listener attached inside it
    // would never exist, and Cancel would do nothing for as long as the
    // command was outstanding — which wedged the whole setup.
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    // Asked for, never answered.
    h.clients[0].execHandler = () => {};
    const controller = new AbortController();

    const running = session.run("long-install", { signal: controller.signal });
    controller.abort();

    await expect(running).rejects.toMatchObject({ kind: "user_cancelled" });
  });

  it("lets go of a channel that arrives after the cancel", async () => {
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    let hand!: (stream: FakeStream) => void;
    h.clients[0].execHandler = (_command, cb) => {
      hand = (stream) => cb(null, stream);
    };
    const controller = new AbortController();
    const running = session.run("long-install", { signal: controller.signal });

    controller.abort();
    const arrived = new FakeStream();
    hand(arrived);

    await expect(running).rejects.toMatchObject({ kind: "user_cancelled" });
    expect(arrived.closed).toBe(true);
  });

  it("asks the connection to notice a peer that stops answering", async () => {
    // Nothing else bounds a command: readyTimeout covers the handshake only.
    await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    expect(h.clients.at(-1)?.connectConfig?.keepaliveInterval).toBeTruthy();
  });

  it("reports the connection dying rather than an exit code", async () => {
    // The keepalive tears down a peer that stopped answering, which closes
    // any open channel with no exit code. Read as an ordinary finish, that
    // becomes "the installer failed (exit undefined)" — the connection's
    // death reported as the command's verdict.
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    let stream!: FakeStream;
    scriptStream(h.clients[0], (s) => {
      stream = s;
    });

    const running = session.run("preflight");
    h.clients[0].emit("error", {
      level: "client-timeout",
      message: "Keepalive timeout",
    });
    // What ssh2 actually emits when no exit-status arrived: its Channel
    // initialises _exit.code to undefined, and utils.js emits that value.
    stream.emit("close", undefined);

    await expect(running).rejects.toMatchObject({ kind: "external" });
  });

  it("keeps a result the command did report, even if the link then died", async () => {
    // The command finished and said how. A connection that dies immediately
    // afterwards must not turn that into a failure of the install.
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    let stream!: FakeStream;
    scriptStream(h.clients[0], (s) => {
      stream = s;
    });

    const running = session.run("preflight");
    h.clients[0].emit("error", {
      level: "client-timeout",
      message: "Keepalive timeout",
    });
    stream.emit("close", 0);

    await expect(running).resolves.toMatchObject({ code: 0 });
  });

  it("says the server stopped rather than telling them to check the address", async () => {
    // Before the handshake, "check the address and that port 22 is open" is
    // the right advice. After it, the address plainly worked — repeating it
    // sends the user to look at the thing that is not wrong.
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    let stream!: FakeStream;
    scriptStream(h.clients[0], (s) => {
      stream = s;
    });

    const running = session.run("preflight");
    h.clients[0].emit("error", {
      level: "client-timeout",
      message: "Keepalive timeout",
    });
    stream.emit("close", undefined);

    await expect(running).rejects.toMatchObject({
      message: expect.stringContaining("stopped answering"),
    });
  });

  it("blames the connection, not the channel, when the link died", async () => {
    // The channel error is only how a dead connection surfaced here. Reported
    // as itself it says "Not connected", which describes the symptom.
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    h.clients[0].emit("error", {
      level: "client-timeout",
      message: "Keepalive timeout",
    });
    h.clients[0].execHandler = (_command, cb) => {
      cb(new Error("Not connected"), undefined);
    };

    await expect(session.run("preflight")).rejects.toMatchObject({
      failure: "timeout",
    });
  });

  it("still reports an ordinary non-zero exit as itself", async () => {
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    scriptStream(h.clients[0], (s) => {
      s.emit("close", 1);
    });

    await expect(session.run("preflight")).resolves.toMatchObject({ code: 1 });
  });

  it("reports a channel error instead of letting it take the process down", async () => {
    // A stream with no error listener throws where it stands, which in the
    // main process means the whole app rather than the command.
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    scriptStream(h.clients[0], (s) => {
      queueMicrotask(() => s.emit("error", new Error("channel died")));
    });

    await expect(session.run("uname -a")).rejects.toThrow(/channel died/);
  });

  it("lets go of the signal when the socket is already gone", async () => {
    // ssh2 throws where it stands rather than calling back, which would skip
    // the cleanup and strand a listener on a signal nobody will ever answer.
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    h.clients[0].execHandler = () => {
      throw new Error("Not connected");
    };
    const controller = new AbortController();
    const letGo = vi.spyOn(controller.signal, "removeEventListener");

    await expect(
      session.run("preflight", { signal: controller.signal }),
    ).rejects.toBeTruthy();

    // Watched directly: an AbortSignal does not say how many listeners it
    // holds, and "nothing bad happened afterwards" is true whether or not one
    // was left behind.
    expect(letGo).toHaveBeenCalled();
  });

  it("gives up on a command that never answers, and closes the channel", async () => {
    // Giving up on the answer is not the same as stopping the work: a command
    // left running holds its channel open until the whole session ends.
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    let stream!: FakeStream;
    scriptStream(h.clients[0], (s) => {
      stream = s;
    });

    // Named apart from a lost connection: the link is still good, so a
    // caller that polls can ask again rather than giving up on the server.
    await expect(
      session.run("docker ps", { timeoutMs: 10 }),
    ).rejects.toMatchObject({ failure: "command-timeout" });
    expect(stream.closed).toBe(true);
  });

  it("leaves a command alone when no bound was asked for", async () => {
    // An installer legitimately runs for minutes with nothing to say, so
    // unbounded stays the default.
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    scriptStream(h.clients[0], (s) => {
      setTimeout(() => s.emit("close", 0), 30);
    });

    await expect(session.run("install.sh")).resolves.toMatchObject({ code: 0 });
  });

  it("refuses before starting when already cancelled", async () => {
    const session = await connectSsh(
      TARGET,
      trustOnFirstUse(() => {}),
    );
    const controller = new AbortController();
    controller.abort();

    await expect(
      session.run("long-install", { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: "user_cancelled" });
  });
});
