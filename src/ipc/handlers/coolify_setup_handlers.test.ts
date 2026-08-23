import { beforeEach, describe, expect, it, vi } from "vitest";
// The mocked class, so the handler recognises what it is handed.
import { SshError } from "../utils/ssh_client";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { SETUP_MACHINE_REPORTED } from "@/ipc/types/coolify_setup";

const h = vi.hoisted(() => ({
  settings: {} as Record<string, unknown>,
  written: [] as Array<Record<string, unknown>>,
  serverKey: { publicKey: "ssh-ed25519 AAAAPUB dyad", privateKey: "PRIVATE" },
  setupResult: null as unknown,
  setupError: null as unknown,
  lastSetupOptions: null as Record<string, unknown> | null,
  sessionEnded: 0,
  reportsAccount: true,
  runCalls: 0,
  verifiedAgainst: [] as string[],
  writeThrows: false,
  /** How many writes fail before the store comes back. */
  writeFailures: 0,
  reportsAccountTwice: false,
  preflightThrows: false,
  preflightReady: true,
  fingerprint: "SHA256:fingerprint",
}));

vi.mock("electron", () => ({ BrowserWindow: { getAllWindows: () => [] } }));

const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
vi.mock("./base", () => ({
  createTypedHandler: (
    contract: { channel: string },
    handler: (...args: unknown[]) => Promise<unknown>,
  ) => handlers.set(contract.channel, handler),
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => h.settings,
  writeSettings: (value: Record<string, unknown>) => {
    if (h.writeFailures > 0) {
      h.writeFailures -= 1;
      throw new Error("keychain is unavailable");
    }
    if (h.writeThrows) throw new Error("keychain is unavailable");
    h.written.push(value);
    Object.assign(h.settings, value);
  },
}));

vi.mock("@/coolify_setup/server_key", () => ({
  ensureServerKey: () => h.serverKey,
}));

vi.mock("../utils/ssh_client", () => ({
  // The real client runs the verifier during the handshake, which is what
  // reports the fingerprint. A mock that skipped it would leave the handler
  // looking correct while reporting nothing.
  connectSsh: vi.fn(
    async (_target: unknown, verify: (fp: string) => boolean) => {
      verify(h.fingerprint);
      return {
        run: vi.fn(),
        end: () => {
          h.sessionEnded += 1;
        },
      };
    },
  ),
  trustOnFirstUse: (onSeen: (fp: string) => void) => (fingerprint: string) => {
    onSeen(fingerprint);
    return true;
  },
  // Recorded where it is built, not where it is called: the flow is mocked
  // here, so what this proves is which verifier the handler chose.
  expectFingerprint: (expected: string) => {
    h.verifiedAgainst.push(expected);
    return (fingerprint: string) => fingerprint === expected;
  },
  SshError: class SshError extends Error {
    constructor(
      readonly failure: string,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/coolify_setup/install", () => ({
  preflight: vi.fn(async () => {
    if (h.preflightThrows) throw new Error("docker never answered");
    return {
      ready: h.preflightReady,
      reason: h.preflightReady ? undefined : "It already has Coolify on it.",
      alreadyInstalled: !h.preflightReady,
      memoryMb: 1967,
    };
  }),
}));

vi.mock("@/coolify_setup/setup_flow", () => ({
  runServerSetup: vi.fn(async (options: Record<string, unknown>) => {
    h.runCalls += 1;
    h.lastSetupOptions = options;
    // The real flow reports the account the moment it exists, before the
    // steps that can still fail.
    if (h.reportsAccount) {
      (
        options.onAccountKnown as (a: {
          credentials: { email: string; password: string };
          dashboardUrl: string;
        }) => void
      )({
        credentials: { email: "me@gmail.com", password: "Abc123@xyz" },
        dashboardUrl: "http://203.0.113.5:8000",
      });
      // And again once HTTPS has settled the address it is reachable at.
      if (h.reportsAccountTwice) {
        (
          options.onAccountKnown as (a: {
            credentials: { email: string; password: string };
            dashboardUrl: string;
          }) => void
        )({
          credentials: { email: "me@gmail.com", password: "Abc123@xyz" },
          dashboardUrl: "https://203.0.113.5.sslip.io",
        });
      }
    }
    if (h.setupError) throw h.setupError;
    return h.setupResult;
  }),
}));

const { registerCoolifySetupHandlers, resetCoolifySetupStateForTests } =
  await import("./coolify_setup_handlers");

/** Install requires a check first, so this is what "run it" means now. */
async function checkThenRun(input: Record<string, unknown> = TARGET) {
  await call("coolify-setup:inspect", input);
  return call("coolify-setup:run", input);
}

function call(channel: string, input?: unknown) {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler for ${channel}`);
  return handler({}, input);
}

const TARGET = {
  host: "203.0.113.5",
  username: "root",
  adminEmail: "me@gmail.com",
};

const RESULT = {
  dashboardUrl: "http://203.0.113.5:8000",
  credentials: {
    username: "dyad-admin",
    email: "me@gmail.com",
    password: "Abc123@xyz",
  },
  token: "1|abc",
  version: "4.3.2",
};

beforeEach(() => {
  handlers.clear();
  h.settings = {};
  h.written.length = 0;
  h.setupResult = RESULT;
  h.setupError = null;
  h.lastSetupOptions = null;
  h.sessionEnded = 0;
  h.reportsAccount = true;
  h.runCalls = 0;
  h.verifiedAgainst.length = 0;
  h.writeThrows = false;
  h.writeFailures = 0;
  h.reportsAccountTwice = false;
  h.preflightThrows = false;
  h.preflightReady = true;
  h.fingerprint = "SHA256:fingerprint";
  resetCoolifySetupStateForTests();
  registerCoolifySetupHandlers();
});

describe("getServerKey", () => {
  it("hands over only the public half", async () => {
    // The private key is what reaches the user's server; it belongs in the
    // main process, exactly like the API token.
    const result = (await call("coolify-setup:get-server-key")) as Record<
      string,
      unknown
    >;
    expect(result).toEqual({ publicKey: h.serverKey.publicKey });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
  });
});

describe("inspect", () => {
  it("reports the fingerprint it saw", async () => {
    const result = (await call("coolify-setup:inspect", TARGET)) as Record<
      string,
      unknown
    >;
    expect(result.hostFingerprint).toBe("SHA256:fingerprint");
    expect(result.ready).toBe(true);
  });

  it("closes the connection it opened", async () => {
    await call("coolify-setup:inspect", TARGET);
    expect(h.sessionEnded).toBe(1);
  });
});

describe("run", () => {
  it("refuses an address Coolify will not accept, before doing anything", async () => {
    // Its seeder resolves the domain. Finding out afterwards costs the whole
    // install and leaves an instance with no account on it.
    await expect(
      call("coolify-setup:run", { ...TARGET, adminEmail: "admin@dyad.test" }),
    ).rejects.toMatchObject({ kind: "validation" });
  });

  it("holds the install to the identity the inspection saw", async () => {
    // The panel shows that fingerprint and asks the user to commit minutes to
    // it. Without the pin, the install accepts whatever answers the address by
    // the time it starts.
    await checkThenRun();

    expect(h.verifiedAgainst).toContain("SHA256:fingerprint");
  });

  it("does not hold one port to what another on the same address showed", async () => {
    // Two services on one address are two servers. Keyed by address alone,
    // the second is checked against the first one's fingerprint and refused.
    await call("coolify-setup:inspect", { ...TARGET, port: 22 });

    await expect(
      call("coolify-setup:run", { ...TARGET, port: 2222 }),
    ).rejects.toThrow(/Check the server/);
  });

  it("does not hold one server to what another one showed", async () => {
    // Addresses are remembered as themselves. Read as URLs, everything shaped
    // like fe80::1 parses as a scheme with no hostname and shares one entry,
    // so a second server would be refused for the first one's key.
    await call("coolify-setup:inspect", { ...TARGET, host: "fe80::1" });

    await expect(
      call("coolify-setup:run", { ...TARGET, host: "fe80::2" }),
    ).rejects.toThrow(/Check the server/);
  });

  it("says the identity changed rather than reporting a cancellation", async () => {
    // host-key-rejected is how a user declining is reported too, and that
    // reads as "nothing happened" — which is the wrong thing to say when a
    // server has been swapped underneath the address.
    await call("coolify-setup:inspect", TARGET);
    h.setupError = new SshError(
      "host-key-rejected",
      "The server's identity was not accepted, so nothing was sent to it.",
      DyadErrorKind.UserCancelled,
    );

    await expect(checkThenRun()).rejects.toThrow(/identity has changed/);
  });

  it("finishes when the account cannot be written down", async () => {
    // The account is on the server either way, and a retry is refused because
    // Coolify is installed now — so ending the run here would lose the only
    // copy of a password Dyad invented.
    h.writeThrows = true;

    await expect(checkThenRun()).resolves.toMatchObject({
      adminPassword: "Abc123@xyz",
      // Nothing was written, so the next screen has no token to use — saying
      // otherwise sends the user to a panel that cannot work.
      tokenStored: false,
      tokenUnavailableReason: expect.stringContaining("could not save"),
    });
  });

  it("refuses a server it has not looked at", async () => {
    // The form disables Install until the check has run, but this is the call
    // that sends the credentials, so it says no on its own account.
    await expect(call("coolify-setup:run", TARGET)).rejects.toThrow(
      /Check the server/,
    );
  });

  it("refuses a server whose check never finished", async () => {
    // Neither the key nor the pass is recorded until a check has finished, so
    // a connection that opened leaves nothing for an install to go on.
    h.preflightThrows = true;
    await expect(call("coolify-setup:inspect", TARGET)).rejects.toThrow();

    await expect(call("coolify-setup:run", TARGET)).rejects.toThrow(
      /Check the server/,
    );
    expect(h.runCalls).toBe(0);
  });

  it("refuses a server the check turned down", async () => {
    h.preflightReady = false;
    await call("coolify-setup:inspect", TARGET);

    await expect(call("coolify-setup:run", TARGET)).rejects.toThrow(
      /Check the server/,
    );
    expect(h.runCalls).toBe(0);
  });

  it("keeps the answer that stands when a re-check does not finish", async () => {
    // The handshake happens before preflight, so recording the key there left
    // the new machine's key beside the old machine's pass — an install onto a
    // server whose check never came back.
    await call("coolify-setup:inspect", TARGET);

    // A different machine answers the address, and its check does not finish.
    h.fingerprint = "SHA256:someone-else";
    h.preflightThrows = true;
    await expect(call("coolify-setup:inspect", TARGET)).rejects.toThrow();
    h.preflightThrows = false;

    // The pass from the finished check still stands, and it is still paired
    // with the key that check saw — not with the one nobody approved.
    await call("coolify-setup:run", TARGET);
    expect(h.verifiedAgainst).toEqual(["SHA256:fingerprint"]);
  });

  it("drops a pass the next check takes back", async () => {
    // A server that was ready and has since had Coolify put on it is not one
    // to install onto, and the second answer is the true one.
    await call("coolify-setup:inspect", TARGET);
    h.preflightReady = false;
    await call("coolify-setup:inspect", TARGET);

    await expect(call("coolify-setup:run", TARGET)).rejects.toThrow(
      /Check the server/,
    );
  });

  it("leaves the one-at-a-time refusal unmarked", async () => {
    // That refusal comes from the machine declining to start, not from a run
    // it took on — so it has nothing on screen of its own, and the panel has
    // to say it. What keeps it unmarked is where start() sits.
    let release!: () => void;
    h.setupResult = new Promise((resolve) => {
      release = () => resolve(RESULT);
    });
    const first = checkThenRun();

    await expect(checkThenRun()).rejects.not.toMatchObject({
      code: SETUP_MACHINE_REPORTED,
    });

    release();
    await first;
  });

  it("leaves an error that carries its own code alone", async () => {
    // A system error names itself — ENOTFOUND and the like — and overwriting
    // that loses what went wrong. Said twice is better than said wrongly.
    h.setupError = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
      code: "ENOTFOUND",
    });

    await expect(checkThenRun()).rejects.toMatchObject({ code: "ENOTFOUND" });
  });

  it("stores the account on the way out when the first attempt failed", async () => {
    // Coolify has the account either way, and preflight refuses to install
    // over it — so a password stored nowhere is a server nobody can sign into.
    // The store is busy for the first write and free by the second.
    h.writeFailures = 1;
    h.reportsAccount = true;
    h.setupError = new DyadError("exit 1", DyadErrorKind.External);

    await expect(checkThenRun()).rejects.toThrow("exit 1");

    const saved = h.written.at(-1) as {
      coolify: { adminPassword: { value: string } };
    };
    expect(saved.coolify.adminPassword.value).toBe("Abc123@xyz");
  });

  it("does not put back an address a later write replaced", async () => {
    // The account is reported twice — once when it exists, and again once
    // HTTPS has settled where it answers. A copy kept from the first would
    // write the earlier address back over the later one on the way out.
    h.writeFailures = 1;
    h.reportsAccount = true;
    h.reportsAccountTwice = true;
    h.setupError = new DyadError("exit 1", DyadErrorKind.External);

    await expect(checkThenRun()).rejects.toThrow("exit 1");

    const saved = h.written.at(-1) as {
      coolify: { adminInstanceUrl: string };
    };
    expect(saved.coolify.adminInstanceUrl).toBe("https://203.0.113.5.sslip.io");
  });

  it("reports what went wrong, not what the retry did", async () => {
    // A write that fails again must not become the failure the user is told
    // about — the install is what they were watching.
    h.writeThrows = true;
    h.reportsAccount = true;
    h.setupError = new DyadError("exit 1", DyadErrorKind.External);

    await expect(checkThenRun()).rejects.toThrow("exit 1");
  });

  it("marks a failure the machine already put on screen", async () => {
    // The panel suppresses what carries this and shows everything else, so
    // the mark is what stops one failure being reported twice.
    h.setupError = new DyadError("exit 1", DyadErrorKind.External);

    await expect(checkThenRun()).rejects.toMatchObject({
      code: SETUP_MACHINE_REPORTED,
    });
  });

  it("leaves a refusal that never started unmarked", async () => {
    // Nothing reached the machine, so nothing is on screen — and an unmarked
    // error is the one the panel says out loud.
    await expect(call("coolify-setup:run", TARGET)).rejects.not.toMatchObject({
      code: SETUP_MACHINE_REPORTED,
    });
  });

  it("stores the token it minted", async () => {
    await checkThenRun();
    const saved = h.written.at(-1) as {
      coolify: { accessToken: { value: string }; instanceUrl: string };
    };
    expect(saved.coolify.accessToken.value).toBe("1|abc");
    expect(saved.coolify.instanceUrl).toBe("http://203.0.113.5:8000");
  });

  it("stores the admin password, so the user is not locked out later", async () => {
    // Dyad invented this password for a machine the user owns. Storing the
    // token but not this leaves them unable to sign in to their own server.
    await checkThenRun();
    const saved = h.written.at(-1) as {
      coolify: { adminPassword?: { value: string }; adminEmail?: string };
    };
    expect(saved.coolify.adminPassword?.value).toBe("Abc123@xyz");
    expect(saved.coolify.adminEmail).toBe("me@gmail.com");
  });

  it("records which instance the account is on", async () => {
    // Connecting Dyad to a different Coolify later has to know this account
    // does not come along.
    await checkThenRun();
    const saved = h.written.at(-1) as {
      coolify: { adminInstanceUrl?: string };
    };
    expect(saved.coolify.adminInstanceUrl).toBe("http://203.0.113.5:8000");
  });

  it("returns the password so it can be shown once", async () => {
    const result = (await checkThenRun()) as Record<string, unknown>;
    expect(result.adminPassword).toBe("Abc123@xyz");
    expect(result.tokenStored).toBe(true);
  });

  it("keeps the install when no token could be created", async () => {
    h.setupResult = {
      ...RESULT,
      token: null,
      tokenUnavailableReason: "too old",
    };
    const result = (await checkThenRun()) as Record<string, unknown>;

    expect(result.tokenStored).toBe(false);
    expect(result.tokenUnavailableReason).toBe("too old");
    expect(result.adminPassword).toBe("Abc123@xyz");

    // The account is kept even though the token is not: this is the one case
    // where the user has to sign in to Coolify themselves, so throwing the
    // password away here would take away the only way to do it.
    const saved = h.written.at(-1) as {
      coolify: {
        adminPassword?: { value: string };
        accessToken?: unknown;
        instanceUrl?: string;
      };
    };
    expect(saved.coolify.adminPassword?.value).toBe("Abc123@xyz");
    // No token and no address, because there is no instance Dyad can talk to.
    expect(saved.coolify.accessToken).toBeUndefined();
    expect(saved.coolify.instanceUrl).toBeUndefined();
  });

  it("keeps the password when the install fails after the account exists", async () => {
    // The dashboard never answering does not un-create the account. Dyad is
    // the only thing that knows the password it invented, so failing here
    // without storing it locks the user out of a server that is running.
    h.setupError = new Error(
      "Coolify was installed but its dashboard did not start.",
    );
    await checkThenRun().catch(() => {});

    const saved = h.written.at(-1) as {
      coolify: { adminPassword?: { value: string }; adminInstanceUrl?: string };
    };
    expect(saved.coolify.adminPassword?.value).toBe("Abc123@xyz");
    expect(saved.coolify.adminInstanceUrl).toBe("http://203.0.113.5:8000");
  });

  it("writes nothing when the failure came before any account", async () => {
    h.reportsAccount = false;
    h.setupError = new Error("This server cannot be set up automatically.");
    await checkThenRun().catch(() => {});

    expect(h.written).toHaveLength(0);
  });

  it("refuses a second setup on a different machine", async () => {
    // Two installs at once would interleave their output, and the second
    // machine's run has nothing to do with the first's.
    let release!: () => void;
    h.setupResult = new Promise((resolve) => {
      release = () => resolve(RESULT);
    });
    const first = checkThenRun();
    // Checked, so the refusal below is the one-at-a-time rule rather than the
    // gate that asks for a check — both refuse the same way.
    await call("coolify-setup:inspect", { ...TARGET, host: "198.51.100.7" });
    await expect(
      call("coolify-setup:run", { ...TARGET, host: "198.51.100.7" }),
    ).rejects.toThrow(/already being set up/);
    release();
    await first;
  });

  it("refuses a second setup on the same machine too", async () => {
    // Nobody needs to press Install to get back to a run any more: the panel
    // asks what is going on and shows it. So a second press is a genuine
    // second request, and two installs on one machine would fight.
    let release!: () => void;
    h.setupResult = new Promise((resolve) => {
      release = () => resolve(RESULT);
    });
    const first = checkThenRun();
    await expect(checkThenRun()).rejects.toMatchObject({
      kind: "precondition",
    });
    release();
    await first;
  });

  it("hands back what is going on, so a panel can show it", async () => {
    let release!: () => void;
    h.setupResult = new Promise((resolve) => {
      release = () => resolve(RESULT);
    });
    await call("coolify-setup:inspect", TARGET);
    const running = call("coolify-setup:run", TARGET);

    const snapshot = (await call("coolify-setup:snapshot")) as {
      type: string;
      host: string;
    };
    expect(snapshot.type).toBe("running");
    expect(snapshot.host).toBe("203.0.113.5");

    release();
    await running;
    expect(
      ((await call("coolify-setup:snapshot")) as { type: string }).type,
    ).toBe("done");
  });

  it("puts the finished screen away when the user moves on", async () => {
    await checkThenRun();
    await call("coolify-setup:dismiss");

    expect(
      ((await call("coolify-setup:snapshot")) as { type: string }).type,
    ).toBe("idle");
  });

  it("frees the slot even when setup failed", async () => {
    h.setupError = new Error("boom");
    await checkThenRun().catch(() => {});
    h.setupError = null;
    await expect(checkThenRun()).resolves.toBeTruthy();
  });
});

describe("revealCredentials", () => {
  it("hands back what Dyad knows about getting in", async () => {
    h.settings = {
      coolify: {
        instanceUrl: "http://203.0.113.5:8000",
        accessToken: { value: "1|abc" },
        adminEmail: "me@gmail.com",
        adminPassword: { value: "Abc123@xyz" },
        adminInstanceUrl: "http://203.0.113.5:8000",
      },
    };
    const result = (await call("coolify-setup:reveal-credentials")) as Record<
      string,
      unknown
    >;
    expect(result).toEqual({
      dashboardUrl: "http://203.0.113.5:8000",
      adminEmail: "me@gmail.com",
      adminPassword: "Abc123@xyz",
      apiToken: "1|abc",
    });
  });

  it("gives the address of a server installed before any token", async () => {
    // Nothing was ever connected, so there is no instanceUrl — but the user
    // still has to know which machine these open.
    h.settings = {
      coolify: {
        adminEmail: "me@gmail.com",
        adminPassword: { value: "Abc123@xyz" },
        adminInstanceUrl: "http://203.0.113.5:8000",
      },
    };
    const result = (await call("coolify-setup:reveal-credentials")) as Record<
      string,
      unknown
    >;
    expect(result.dashboardUrl).toBe("http://203.0.113.5:8000");
    expect(result.adminPassword).toBe("Abc123@xyz");
  });

  it("names the server by the address the token was saved for", async () => {
    // The two differ when a server installed at its bare address is connected
    // under the domain it was given afterwards. The address Dyad is talking
    // to is the one that reaches Coolify, so it is the one shown.
    h.settings = {
      coolify: {
        instanceUrl: "https://coolify.example.com",
        accessToken: { value: "1|abc" },
        adminEmail: "me@gmail.com",
        adminPassword: { value: "Abc123@xyz" },
        adminInstanceUrl: "http://203.0.113.5:8000",
      },
    };
    const result = (await call("coolify-setup:reveal-credentials")) as Record<
      string,
      unknown
    >;
    expect(result.dashboardUrl).toBe("https://coolify.example.com");
    // Still the same box, so its account is still what opens it.
    expect(result.adminPassword).toBe("Abc123@xyz");
  });

  it("has nothing to hand back once the instance is forgotten", async () => {
    // Signing out clears all of it, so there is no address or password left
    // for the panel to put on screen.
    h.settings = { coolify: {} };
    const result = (await call("coolify-setup:reveal-credentials")) as Record<
      string,
      unknown
    >;
    expect(result).toEqual({
      dashboardUrl: null,
      adminEmail: null,
      adminPassword: null,
      apiToken: null,
    });
  });

  it("answers nulls for an instance Dyad did not set up", async () => {
    // Connected by pasting a token, so there is no account Dyad created and
    // nothing here it could hand back.
    h.settings = {
      coolify: {
        instanceUrl: "https://coolify.example.com",
        accessToken: { value: "1|abc" },
      },
    };
    const result = (await call("coolify-setup:reveal-credentials")) as Record<
      string,
      unknown
    >;
    expect(result.adminPassword).toBeNull();
    expect(result.adminEmail).toBeNull();
    expect(result.apiToken).toBe("1|abc");
  });
});

describe("cancel", () => {
  it("aborts the running setup", async () => {
    let release!: () => void;
    h.setupResult = new Promise((resolve) => {
      release = () => resolve(RESULT);
    });
    await call("coolify-setup:inspect", TARGET);
    const running = call("coolify-setup:run", TARGET);
    // The flow is handed a signal; cancelling is what trips it.
    const signal = h.lastSetupOptions?.signal as AbortSignal;
    expect(signal.aborted).toBe(false);

    await call("coolify-setup:cancel");
    expect(signal.aborted).toBe(true);
    release();
    await running;
  });

  it("does nothing when nothing is running", async () => {
    await expect(call("coolify-setup:cancel")).resolves.toBeUndefined();
  });
});
