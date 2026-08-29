import { describe, expect, it, vi } from "vitest";
import {
  buildInstallScript,
  installCoolify,
  preflight,
  waitForAdminSeeded,
} from "./install";
import { SshError } from "@/ipc/utils/ssh_client";
import type { SshSession } from "@/ipc/utils/ssh_client";
import { DyadErrorKind } from "@/errors/dyad_error";

/**
 * What Dyad concludes when a server does not answer properly.
 *
 * The interesting cases here are not the ones where a server says something
 * unexpected — they are the ones where it says nothing at all, because every
 * answer is read out of one transcript and an empty transcript still parses.
 */

function sessionAnswering(run: SshSession["run"]): SshSession {
  return { run, end: vi.fn() } as unknown as SshSession;
}

const HEALTHY = "mem=1967\ncontainer=\nbusy=no";

/** What a tinker script's output looks like coming back off the wire. */
function transcript(output: string): string {
  return [
    '> echo "__DYAD_OUT_START__" . PHP_EOL;',
    "> __DYAD_OUT_START__",
    output,
    "__DYAD_OUT_END__",
  ].join("\n");
}

describe("what the installer is sent", () => {
  const CREDENTIALS = {
    username: "dyad",
    email: "me@gmail.com",
    password: "Abc123@xyz",
  };

  it("keeps the password out of the command line", async () => {
    // Anyone with a shell on that machine can read a command line out of ps.
    let sentCommand = "";
    let sentInput: string | undefined;
    const session = {
      run: async (command: string, options?: { input?: string }) => {
        sentCommand = command;
        sentInput = options?.input;
        return { code: 0, stdout: "", stderr: "" };
      },
      end: () => {},
    };

    await installCoolify(session as never, CREDENTIALS);

    expect(sentCommand).not.toContain(CREDENTIALS.password);
    expect(sentInput).toContain(CREDENTIALS.password);
  });

  it("fails the install when the download fails", () => {
    // curl reports the failure and bash, handed nothing, exits 0 — so without
    // this the pipeline's status is 0 and a server with no Coolify on it
    // reads as installed.
    expect(buildInstallScript(CREDENTIALS)).toContain("set -o pipefail");
  });

  it("feeds the script over stdin rather than as arguments", async () => {
    let sent: string | undefined;
    const session = {
      run: async (_command: string, options?: { input?: string }) => {
        sent = options?.input;
        return { code: 0, stdout: "", stderr: "" };
      },
      end: () => {},
    };

    await installCoolify(session as never, CREDENTIALS);

    expect(sent).toContain(CREDENTIALS.password);
  });

  it("refuses a credential that could end its own quoting", () => {
    expect(() =>
      buildInstallScript({ ...CREDENTIALS, password: "a'; rm -rf /" }),
    ).toThrow();
  });
});

describe("preflight", () => {
  it("reads a healthy server as ready", async () => {
    const session = sessionAnswering(
      vi.fn(async () => ({ code: 0, stdout: HEALTHY, stderr: "" })) as never,
    );
    await expect(preflight(session)).resolves.toMatchObject({
      ready: true,
      alreadyInstalled: false,
      memoryMb: 1967,
    });
  });

  it("refuses when docker is there but will not say what it is running", async () => {
    // A stopped daemon reports no containers, which reads exactly like a
    // machine with no Coolify — and installing over an instance that is
    // merely stopped is the outcome worth refusing.
    const session = sessionAnswering(
      vi.fn(async () => ({
        code: 0,
        stdout: "mem=1967\ncontainer=\ndockerok=no\nbusy=no\n",
        stderr: "",
      })) as never,
    );

    await expect(preflight(session)).resolves.toMatchObject({
      ready: false,
      alreadyInstalled: false,
    });
  });

  it("refuses a probe that came back with nothing", async () => {
    // An empty transcript parses as "no memory, no container, not busy" —
    // which reads as a healthy empty server, and that is the one wrong answer
    // that matters: it stands between the user and installing over a Coolify
    // that is already there.
    const session = sessionAnswering(
      vi.fn(async () => ({ code: 1, stdout: "", stderr: "" })) as never,
    );
    const checks = await preflight(session);

    expect(checks.ready).toBe(false);
    expect(checks.alreadyInstalled).toBe(false);
    expect(checks.reason).toContain("could not read");
  });

  it("refuses a server whose memory it could not read", async () => {
    // A server that answers the question but not this part of it sends back
    // `mem=` — empty, not missing, so the whole-transcript guard above does
    // not fire and the size check has nothing to compare. Read as ready, the
    // 2GB rule is quietly absent: the install finishes and Coolify does not
    // run, on a machine that now refuses a second attempt.
    const session = sessionAnswering(
      vi.fn(async () => ({
        code: 0,
        stdout: "mem=\ncontainer=\nbusy=no",
        stderr: "",
      })) as never,
    );
    const checks = await preflight(session);

    expect(checks.ready).toBe(false);
    expect(checks.memoryMb).toBeNull();
    expect(checks.reason).toContain("could not read how much memory");
    // It answered about Coolify, so that part is not in doubt.
    expect(checks.installedKnown).toBe(true);
  });

  it("still reports a server that is busy", async () => {
    const session = sessionAnswering(
      vi.fn(async () => ({
        code: 0,
        stdout: "mem=1967\ncontainer=\nbusy=yes",
        stderr: "",
      })) as never,
    );
    await expect(preflight(session)).resolves.toMatchObject({ ready: false });
  });
});

describe("a server that answers the connection but not the question", () => {
  it("gives up on the probe rather than leaving the step running", async () => {
    // A wedged docker answers nothing. Without a bound the panel sits on
    // "Checking the server" until the user works out that nothing is
    // happening and stops it themselves.
    const asked: Array<number | undefined> = [];
    const session = sessionAnswering(
      vi.fn(async (_c: string, options?: { timeoutMs?: number }) => {
        asked.push(options?.timeoutMs);
        return { code: 0, stdout: HEALTHY, stderr: "" };
      }) as never,
    );

    await preflight(session);
    expect(asked[0]).toBeGreaterThan(0);
  });

  it("leaves the installer alone, which legitimately takes minutes", async () => {
    const asked: Array<number | undefined> = [];
    const session = sessionAnswering(
      vi.fn(async (command: string, options?: { timeoutMs?: number }) => {
        if (command.includes("install.sh")) asked.push(options?.timeoutMs);
        return { code: 0, stdout: "", stderr: "" };
      }) as never,
    );

    await installCoolify(session, {
      username: "dyad-admin",
      email: "me@gmail.com",
      password: "Abc123@xyz",
    });
    expect(asked).toEqual([undefined]);
  });
});

describe("waiting for the admin account", () => {
  it("asks with a bound, so one hung attempt cannot outlast the loop", async () => {
    // The deadline is only looked at between attempts, so an unbounded
    // question outlasts every bound there is. The bound belongs in the
    // command — giving up on the answer should also stop the asking — so
    // what is checked here is that the question carries one.
    const asked: Array<{ timeoutMs?: number }> = [];
    const session = sessionAnswering(
      vi.fn(async (_command: string, options?: { timeoutMs?: number }) => {
        asked.push({ timeoutMs: options?.timeoutMs });
        return { code: 0, stdout: transcript("yes"), stderr: "" };
      }) as never,
    );

    await expect(
      waitForAdminSeeded(session, "me@gmail.com", {
        timeoutMs: 2_000,
        intervalMs: 1,
        attemptTimeoutMs: 20,
      }),
    ).resolves.toEqual({ seeded: true });

    expect(asked[0]?.timeoutMs).toBe(20);
  });

  it("hands back a server to sign in to when the seeder itself dies", async () => {
    // Coolify is on the machine either way. Ending the run here would report
    // an install that did not happen and take the password Dyad invented down
    // with it, when the honest answer is to go and sign in by hand.
    const session = sessionAnswering(
      vi.fn(async (command: string) => {
        if (command.includes("RootUserSeeder")) throw new Error("wedged");
        return { code: 0, stdout: transcript("no"), stderr: "" };
      }) as never,
    );

    await expect(
      waitForAdminSeeded(session, "me@gmail.com", {
        timeoutMs: 20,
        intervalMs: 1,
        attemptTimeoutMs: 20,
      }),
    ).resolves.toEqual({ seeded: false, reason: undefined });
  });

  it("keeps a cancellation a cancellation", async () => {
    // Stopping throws here like anywhere else. Swallowed, it would end the run
    // by telling the user to sign in to an install they just stopped.
    const controller = new AbortController();
    const session = sessionAnswering(
      vi.fn(async (command: string) => {
        if (command.includes("RootUserSeeder")) {
          controller.abort();
          throw new Error("aborted");
        }
        return { code: 0, stdout: transcript("no"), stderr: "" };
      }) as never,
    );

    await expect(
      waitForAdminSeeded(session, "me@gmail.com", {
        timeoutMs: 20,
        intervalMs: 1,
        attemptTimeoutMs: 20,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.UserCancelled });
  });

  it("sees the account past a notice printed beside the answer", async () => {
    // Required to be the whole answer, one deprecation notice would report a
    // seeded account as missing — and the run then fails with Coolify
    // refusing to create an account it already created.
    const session = sessionAnswering(
      vi.fn(async () => ({
        code: 0,
        stdout: transcript("PHP Deprecated: something\nyes"),
        stderr: "",
      })) as never,
    );

    await expect(
      waitForAdminSeeded(session, "me@gmail.com", {
        timeoutMs: 50,
        intervalMs: 1,
        attemptTimeoutMs: 50,
      }),
    ).resolves.toMatchObject({ seeded: true });
  });

  it("bounds the repair and the confirmation after it, not only the poll", async () => {
    // The loop expiring is where the seeder runs, and the question after it
    // is the same question — asked on the same server that just failed to
    // answer four times.
    const asked: Array<{ command: string; timeoutMs?: number }> = [];
    const session = sessionAnswering(
      vi.fn(async (command: string, options?: { timeoutMs?: number }) => {
        asked.push({ command, timeoutMs: options?.timeoutMs });
        return { code: 0, stdout: transcript("no"), stderr: "" };
      }) as never,
    );

    await waitForAdminSeeded(session, "me@gmail.com", {
      timeoutMs: 20,
      intervalMs: 1,
      attemptTimeoutMs: 50,
    });

    // Every question, including the seeder and the confirmation after it.
    expect(asked.length).toBeGreaterThan(1);
    for (const question of asked) {
      expect(question.timeoutMs).toBeGreaterThan(0);
    }
  });

  it("asks again when one attempt was merely slow", async () => {
    // The bound is ours, not the server's: the link is fine and the poll has
    // minutes left. Treating it as a dead link ended the wait on the first
    // slow answer, on a server where the account had in fact been seeded.
    let asked = 0;
    const session = sessionAnswering(
      vi.fn(async () => {
        asked += 1;
        if (asked === 1) {
          throw new SshError(
            "command-timeout",
            "The server did not answer in time.",
            DyadErrorKind.External,
          );
        }
        return { code: 0, stdout: transcript("yes"), stderr: "" };
      }) as never,
    );

    await expect(
      waitForAdminSeeded(session, "me@gmail.com", {
        timeoutMs: 2_000,
        intervalMs: 1,
      }),
    ).resolves.toEqual({ seeded: true });
    expect(asked).toBeGreaterThan(1);
  });

  it("reports the seeder's words when the last question times out", async () => {
    // A bound being hit is not an answer, and it must not become the answer:
    // the seeder has already said why it refused, and that is what the user
    // needs. Pinned because the bound and the rethrow rule are set in two
    // different places and either could stop agreeing with the other.
    let asked = 0;
    const session = sessionAnswering(
      vi.fn(async (command: string) => {
        asked += 1;
        if (command.includes("db:seed")) {
          return {
            code: 0,
            stdout: "ERROR  Invalid Root User Environment Variables\n",
            stderr: "",
          };
        }
        throw new SshError(
          "command-timeout",
          "The server did not answer in time.",
          DyadErrorKind.External,
        );
      }) as never,
    );

    const outcome = await waitForAdminSeeded(session, "me@gmail.com", {
      timeoutMs: 20,
      intervalMs: 1,
      attemptTimeoutMs: 5,
    });

    expect(outcome.seeded).toBe(false);
    expect(outcome.reason).toContain("Invalid Root User");
    expect(asked).toBeGreaterThan(1);
  });

  it("does not report a dead link as Coolify refusing the address", async () => {
    // Waiting longer cannot revive a connection. Swallowed, it becomes a
    // complaint about the email address — after polling a dead link for a
    // minute and a half and then running the seeder down it as well.
    let asked = 0;
    const session = sessionAnswering(
      vi.fn(async () => {
        asked += 1;
        throw new SshError(
          "timeout",
          "The server stopped answering.",
          DyadErrorKind.External,
        );
      }) as never,
    );

    await expect(
      waitForAdminSeeded(session, "me@gmail.com", {
        timeoutMs: 2_000,
        intervalMs: 1,
      }),
    ).rejects.toMatchObject({ failure: "timeout" });
    // Once: it gave up on the first answer rather than polling a dead link
    // and then asking the seeder down the same one.
    expect(asked).toBe(1);
  });
});
