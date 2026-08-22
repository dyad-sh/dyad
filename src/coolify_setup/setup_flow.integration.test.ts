import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runServerSetup } from "./setup_flow";
import { connectSsh, trustOnFirstUse } from "@/ipc/utils/ssh_client";
import type { SshSession } from "@/ipc/utils/ssh_client";
import {
  generateSshKeyPair,
  startFakeSshServer,
  type FakeSshServer,
} from "../../e2e-tests/helpers/fake_ssh_server";

/**
 * The setup flow over a real SSH connection, without the app around it.
 *
 * Dyad's own SSH client talks to a real ssh2 server here, so preflight, the
 * installer and the tinker transcripts these tests reach are parsed from the
 * shapes the library actually produces rather than ones a hand-written fake
 * finds convenient.
 *
 * Only the two HTTP steps are stubbed: whether a dashboard answers and
 * whether a certificate is issued are not questions a server on loopback can
 * be asked, and neither goes over SSH.
 *
 * These live here rather than in e2e because none of them looks at the
 * screen. The packaged app proves the wiring — that the handler is registered
 * and the panel renders what it returns — and that is what the two remaining
 * Playwright specs are for.
 */

const KEY = generateSshKeyPair().private;

let server: FakeSshServer | undefined;

beforeEach(async () => {
  server = await startFakeSshServer();
});

afterEach(async () => {
  // Optional: a server that failed to start leaves nothing to close, and
  // throwing here would bury the reason it failed under a second error.
  await server?.close();
  server = undefined;
});

function runSetup() {
  const output: string[] = [];
  const done = runServerSetup({
    onProgress: ({ output: chunk }) => {
      if (chunk) output.push(chunk);
    },
    target: {
      host: "127.0.0.1",
      port: server!.port,
      username: "root",
      privateKey: KEY,
    },
    adminEmail: "me@gmail.com",
    verifyHostKey: trustOnFirstUse(() => {}),
    connect: (target, verify, signal): Promise<SshSession> =>
      connectSsh(target, verify, { signal }),
    // The dashboard is a URL, not a server: there is nothing on loopback to
    // answer it, and answering it is not what these tests are about.
    waitForDashboardImpl: async () => true,
    tryEnableHttpsImpl: async (_session, host) => ({
      instanceUrl: `http://${host}:8000`,
      secure: false,
      reason: "A loopback address cannot be given a certificate.",
    }),
  });
  return { done, output };
}

describe("a server that refuses the install", () => {
  it("reports what the installer said, not only that it failed", async () => {
    // The installer's most common failure is losing a race for the package
    // lock, and an exit code alone says nothing about that. Its last words do.
    server!.state.installExit = 1;
    const { done, output } = runSetup();

    await expect(done).rejects.toThrow(/Coolify is up/);
    // And through the stream, which is a different path: the panel's log is
    // built from what arrives here, not from the message thrown at the end.
    expect(output.join("")).toContain("Coolify is up");
  });
});

describe("a Coolify too old to make its own token", () => {
  it("finishes anyway and hands back the sign-in details", async () => {
    // The server is installed and usable; only the token has to be made by
    // hand. Throwing here would discard a working install.
    server!.state.version = "3.1.0";

    const result = await runSetup().done;

    expect(result.token).toBeNull();
    expect(result.tokenUnavailableReason).toBeTruthy();
    expect(result.credentials.email).toBe("me@gmail.com");
    expect(result.credentials.password).not.toBe("");
  });
});

describe("a server that reports its exit status late", () => {
  it("does not read the end of the output as the end of the command", async () => {
    // A real sshd closes a command's output when its stdout closes and reports
    // the status when the process is reaped. Closing the channel on the first
    // of those loses the status — a finished install read as a failure, and
    // against a real server a command killed while it was still running.
    server!.state.exitAfterEofMs = 50;

    const result = await runSetup().done;

    expect(result.token).toBeTruthy();
    expect(result.version).toBeTruthy();
  });
});
