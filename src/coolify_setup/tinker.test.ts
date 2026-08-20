import { describe, expect, it, vi } from "vitest";
import { extractOutput, runTinker, tinkerCommand, wrapScript } from "./tinker";
import type { SshSession } from "@/ipc/utils/ssh_client";

/**
 * A transcript captured from Coolify 4.3.2 rather than written by hand.
 *
 * The shape is the whole reason this module exists: tinker echoes every line it
 * is fed with a `> ` prefix, so the markers appear twice — and the first line of
 * real output shares a line with the last prompt.
 */
const REAL_TRANSCRIPT = [
  '> echo "__DYAD_OUT_START__" . PHP_EOL;',
  "",
  '> echo "line-one" . PHP_EOL; echo "line-two" . PHP_EOL;',
  '> echo "__DYAD_OUT_END__" . PHP_EOL;',
  "> __DYAD_OUT_START__",
  "line-one",
  "line-two",
  "__DYAD_OUT_END__",
].join("\n");

function fakeSession(
  onRun: (command: string, options?: { input?: string }) => { stdout: string },
): SshSession & { calls: Array<{ command: string; input?: string }> } {
  const calls: Array<{ command: string; input?: string }> = [];
  return {
    calls,
    run: vi.fn(async (command: string, options?: { input?: string }) => {
      calls.push({ command, input: options?.input });
      return { code: 0, stderr: "", ...onRun(command, options) };
    }) as unknown as SshSession["run"],
    end: vi.fn(),
  };
}

describe("the container it runs in", () => {
  it("refuses a name that could end the command", async () => {
    // The name is interpolated into a command that runs as root, and both
    // command shapes build it themselves.
    expect(() => tinkerCommand("coolify; rm -rf /")).toThrow();
    await expect(
      runTinker(
        { run: async () => ({ code: 0, stdout: "", stderr: "" }) } as never,
        "echo 1;",
        {
          container: "coolify; rm -rf /",
          env: { A: "b" },
        },
      ),
    ).rejects.toMatchObject({ kind: "validation" });
  });
});

describe("extractOutput", () => {
  it("takes the printed output, not the echo of the line printing it", () => {
    // Both appear in the transcript. Matching the marker without its prompt
    // would find the echoed input first and return the script back.
    expect(extractOutput(REAL_TRANSCRIPT)).toBe("line-one\nline-two");
  });

  it("says nothing was found when the script never ran", () => {
    // A container still starting answers with an error and no markers at all.
    // Reading that as empty output would let a caller treat "no token" as a
    // fact rather than as a failure.
    expect(
      extractOutput("Error response from daemon: container not running"),
    ).toBeNull();
  });

  it("says nothing was found when the output stops halfway", () => {
    const truncated = REAL_TRANSCRIPT.split("\n").slice(0, 6).join("\n");
    expect(extractOutput(truncated)).toBeNull();
  });

  it("finds output from a script that printed no trailing newline", () => {
    // The real shape before wrapScript was fixed: value and marker on one line.
    const glued = [
      '> echo "__DYAD_OUT_START__" . PHP_EOL;',
      "> __DYAD_OUT_START__",
      "yes",
      "__DYAD_OUT_END__",
    ].join("\n");
    expect(extractOutput(glued)).toBe("yes");
  });

  it("survives carriage returns", () => {
    expect(extractOutput(REAL_TRANSCRIPT.replace(/\n/g, "\r\n"))).toBe(
      "line-one\nline-two",
    );
  });
});

describe("tinkerCommand", () => {
  it("attaches stdin", () => {
    // Without -i docker does not attach stdin, so the script is never read and
    // the command succeeds having done nothing at all.
    expect(tinkerCommand()).toContain("docker exec -i ");
  });
});

describe("runTinker", () => {
  it("feeds the script on stdin rather than the command line", async () => {
    const session = fakeSession(() => ({ stdout: REAL_TRANSCRIPT }));
    await runTinker(session, 'echo "line-one" . PHP_EOL;');

    expect(session.calls[0].input).toContain('echo "line-one" . PHP_EOL;');
    expect(session.calls[0].command).not.toContain("line-one");
  });

  it("passes a secret by name and value, quoted", async () => {
    const session = fakeSession(() => ({ stdout: REAL_TRANSCRIPT }));
    await runTinker(session, "echo getenv('DYAD_SECRET');", {
      env: { DYAD_SECRET: "p@ssw0rd-+=" },
    });

    expect(session.calls[0].command).toContain("-e DYAD_SECRET='p@ssw0rd-+='");
    // The value stays out of the script, so it never meets PHP's parser too.
    expect(session.calls[0].input).not.toContain("p@ssw0rd");
  });

  it("refuses a value that would escape its quoting", async () => {
    const session = fakeSession(() => ({ stdout: REAL_TRANSCRIPT }));
    // Rejected rather than escaped: getting this subtly wrong runs arbitrary
    // text as a command on the user's server.
    await expect(
      runTinker(session, "echo 1;", {
        env: { DYAD_SECRET: "a'; rm -rf /; '" },
      }),
    ).rejects.toMatchObject({ kind: "internal" });
  });

  it("refuses a variable name that is not a plain identifier", async () => {
    const session = fakeSession(() => ({ stdout: REAL_TRANSCRIPT }));
    await expect(
      runTinker(session, "echo 1;", { env: { "X; rm -rf /": "v" } }),
    ).rejects.toMatchObject({ kind: "internal" });
  });

  it("fails loudly when the script did not run", async () => {
    const session = fakeSession(() => ({ stdout: "container not running" }));
    await expect(runTinker(session, "echo 1;")).rejects.toMatchObject({
      kind: "external",
    });
  });

  it("targets a named container when asked", async () => {
    const session = fakeSession(() => ({ stdout: REAL_TRANSCRIPT }));
    await runTinker(session, "echo 1;", { container: "coolify-staging" });
    expect(session.calls[0].command).toContain(" coolify-staging ");
  });
});

describe("wrapScript", () => {
  it("breaks the line before the closing marker", () => {
    // Captured from a real run: a script ending without PHP_EOL produced
    // `yes__DYAD_OUT_END__`, and the marker was never found.
    expect(wrapScript("echo 'yes';")).toContain(
      'echo PHP_EOL . "__DYAD_OUT_END__"',
    );
  });

  it("puts the body between the markers", () => {
    const wrapped = wrapScript("echo 42;");
    const lines = wrapped.split("\n");
    expect(lines[0]).toContain("__DYAD_OUT_START__");
    expect(lines[1]).toBe("echo 42;");
    expect(lines[2]).toContain("__DYAD_OUT_END__");
  });
});
