import { describe, expect, it, vi } from "vitest";
import { COOLIFY_SCOPES_PHP_ARRAY } from "@/shared/coolify_scopes";
import {
  compareVersions,
  enableApi,
  mintApiToken,
  readCoolifyVersion,
  supportsAutomaticToken,
  tryAutomaticAccess,
} from "./api_token";
import { DyadErrorKind } from "@/errors/dyad_error";
import { SshError } from "@/ipc/utils/ssh_client";
import type { SshSession } from "@/ipc/utils/ssh_client";

/** Wraps a value the way a real tinker transcript carries it. */
function transcript(output: string): string {
  return [
    '> echo "__DYAD_OUT_START__" . PHP_EOL;',
    "> __DYAD_OUT_START__",
    output,
    "__DYAD_OUT_END__",
  ].join("\n");
}

/** A token of the shape Sanctum actually returns. */
const REAL_TOKEN = "1|EcaUxT43T5fgdLJmnYj0702tEUC6viy5jEhO3Ujk2298db95";

function fakeSession(replies: string[]): SshSession & {
  scripts: string[];
  commands: string[];
} {
  const scripts: string[] = [];
  const commands: string[] = [];
  let call = 0;
  return {
    scripts,
    commands,
    run: vi.fn(async (command: string, options?: { input?: string }) => {
      commands.push(command);
      scripts.push(options?.input ?? "");
      const reply = replies[Math.min(call, replies.length - 1)];
      call += 1;
      return { code: 0, stdout: transcript(reply), stderr: "" };
    }) as unknown as SshSession["run"],
    end: vi.fn(),
  };
}

describe("compareVersions", () => {
  it("orders by number, not by text", () => {
    // Compared as strings, "4.10.0" sorts below "4.9.0" and the automated path
    // would quietly switch itself off on newer instances.
    expect(compareVersions("4.10.0", "4.9.0")).toBe(1);
    expect(compareVersions("4.3.2", "4.3.2")).toBe(0);
    expect(compareVersions("4.3", "4.3.0")).toBe(0);
    expect(compareVersions("3.9.9", "4.0.0")).toBe(-1);
  });
});

describe("supportsAutomaticToken", () => {
  it.each([
    ["4.3.2", true],
    ["4.0.0", true],
    ["4.10.0", true],
    ["3.9.0", false],
    [null, false],
  ])("reads %s as %s", (version, expected) => {
    expect(supportsAutomaticToken(version)).toBe(expected);
  });
});

describe("readCoolifyVersion", () => {
  it("asks the instance, because the installer picks the version", async () => {
    const session = fakeSession(["4.3.2"]);
    expect(await readCoolifyVersion(session)).toBe("4.3.2");
  });

  it("answers null when the reply is not a version", async () => {
    const session = fakeSession(["Command not found"]);
    expect(await readCoolifyVersion(session)).toBeNull();
  });

  it("does not call a lost link an unreadable version", async () => {
    // Answering null here sends the caller down the path that tells the user
    // their freshly installed Coolify is too old to drive, for a question
    // that never reached it.
    const session = {
      run: vi.fn(async () => {
        throw new SshError(
          // The connection stopped answering, which is the case this tells
          // apart from a bound Dyad set on one command.
          "timeout",
          "the connection stopped answering",
          DyadErrorKind.External,
        );
      }),
      end: vi.fn(),
    } as unknown as SshSession;

    await expect(readCoolifyVersion(session)).rejects.toBeInstanceOf(SshError);
  });

  it("says a slow answer was slow rather than calling the version old", async () => {
    // The instance is reachable and simply did not answer in time, which on
    // a small server right after an install is ordinary. Answered as null,
    // the user is told the Coolify they just installed is too old to drive.
    const session = {
      run: vi.fn(async () => {
        throw new SshError(
          "command-timeout",
          "timed out",
          DyadErrorKind.External,
        );
      }),
      end: vi.fn(),
    } as unknown as SshSession;

    await expect(readCoolifyVersion(session)).rejects.toThrow(
      /did not answer in time/,
    );
  });

  it("does not call a container still starting an unreadable version", async () => {
    // No markers back means the script never ran — a container still coming
    // up. Its own message says to wait, which is the useful thing to say.
    const session = {
      run: vi.fn(async () => ({ code: 0, stdout: "", stderr: "" })),
      end: vi.fn(),
    } as unknown as SshSession;

    await expect(readCoolifyVersion(session)).rejects.toThrow(
      /may still be starting/,
    );
  });
});

describe("enableApi", () => {
  it("confirms the setting took rather than assuming the write worked", async () => {
    const session = fakeSession(["enabled"]);
    await expect(enableApi(session)).resolves.toBeUndefined();
    expect(session.scripts[0]).toContain("is_api_enabled = true");
    // Read back from the database rather than off the property just set:
    // tinker carries on after a statement throws, so a save that never
    // happened would otherwise still answer "enabled".
    expect(session.scripts[0]).toContain("$ok = $s->save()");
    expect(session.scripts[0]).toContain(
      "$ok && \\App\\Models\\InstanceSettings::get()->is_api_enabled",
    );
  });

  it("fails when the setting did not take", async () => {
    const session = fakeSession(["still-disabled"]);
    await expect(enableApi(session)).rejects.toMatchObject({
      kind: "external",
    });
  });
});

describe("mintApiToken", () => {
  it("seeds a team into the session before creating the token", async () => {
    // Not defensive: Coolify's createToken override stamps the row with
    // session('currentTeam')->id, and tinker has no session, so the insert
    // fails on a not-null team_id without this.
    const session = fakeSession([REAL_TOKEN]);
    await mintApiToken(session, "admin@gmail.com");
    expect(session.scripts[0]).toContain("session(['currentTeam' => $team])");
  });

  it("asks for the scopes Dyad tells users to tick", async () => {
    // Narrower tokens hide a server's private key id, which the deploy path
    // reads to tell a stale key from one it simply cannot see.
    const session = fakeSession([REAL_TOKEN]);
    await mintApiToken(session, "admin@gmail.com");
    // The same list the panel tells a user to tick and the 403 message names,
    // so a token Dyad mints and one made by hand behave alike. Not root, which
    // Coolify treats as a bypass of the ability check rather than a scope.
    expect(session.scripts[0]).toContain(COOLIFY_SCOPES_PHP_ARRAY);
    expect(session.scripts[0]).not.toContain("root");
  });

  it("keeps the address out of the script", async () => {
    const session = fakeSession([REAL_TOKEN]);
    await mintApiToken(session, "admin@gmail.com");
    expect(session.scripts[0]).not.toContain("admin@gmail.com");
    expect(session.commands[0]).toContain(
      "-e DYAD_ADMIN_EMAIL='admin@gmail.com'",
    );
  });

  it("uses no early return, which tinker cannot parse", async () => {
    // A `return` at top level is a parse error, and a script that does not
    // parse prints nothing at all — so the branch it guarded never reports.
    const session = fakeSession([REAL_TOKEN]);
    await mintApiToken(session, "admin@gmail.com");
    expect(session.scripts[0]).not.toMatch(/\breturn\s*;/);
  });

  it("says so when the account does not exist", async () => {
    const session = fakeSession(["no-user"]);
    await expect(
      mintApiToken(session, "nobody@gmail.com"),
    ).rejects.toMatchObject({
      kind: "precondition",
    });
  });

  it("says so when the account has no team", async () => {
    const session = fakeSession(["no-team"]);
    await expect(
      mintApiToken(session, "admin@gmail.com"),
    ).rejects.toMatchObject({
      kind: "precondition",
    });
  });

  it("refuses anything that is not a token", async () => {
    // A warning line stored as a credential fails much later, somewhere that
    // cannot explain what went wrong.
    const session = fakeSession(["PHP Warning: something"]);
    await expect(
      mintApiToken(session, "admin@gmail.com"),
    ).rejects.toMatchObject({
      kind: "external",
    });
  });

  it("refuses a token name that could break out of its quoting", async () => {
    const session = fakeSession([REAL_TOKEN]);
    await expect(
      mintApiToken(session, "admin@gmail.com", {
        tokenName: "a', ['root'], null); //",
      }),
    ).rejects.toMatchObject({ kind: "internal" });
  });
});

describe("tryAutomaticAccess", () => {
  it("returns a token when the instance can be driven", async () => {
    const session = fakeSession(["4.3.2", "enabled", REAL_TOKEN]);
    const access = await tryAutomaticAccess(session, "admin@gmail.com");
    expect(access?.token).toBe(REAL_TOKEN);
    expect(access?.version).toBe("4.3.2");
  });

  it("declines quietly on an instance it does not know", async () => {
    // Not a failure: an instance Dyad did not install is the ordinary case,
    // and the caller asks for a token by hand instead.
    const session = fakeSession(["3.1.0"]);
    expect(await tryAutomaticAccess(session, "admin@gmail.com")).toBeNull();
  });

  it("does not try to enable the API on an instance it declined", async () => {
    const session = fakeSession(["3.1.0"]);
    await tryAutomaticAccess(session, "admin@gmail.com");
    expect(session.scripts.some((s) => s.includes("is_api_enabled"))).toBe(
      false,
    );
  });
});
