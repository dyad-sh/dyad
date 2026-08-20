import { describe, expect, it, vi } from "vitest";
import { installCoolify, preflight, waitForAdminSeeded } from "./install";
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
