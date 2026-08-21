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
  preflightThrows: false,
  preflightReady: true,
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
      verify("SHA256:fingerprint");
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
  h.preflightThrows = false;
  h.preflightReady = true;
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

  it("clears a token kept from an instance it has moved off", async () => {
    // Saving a token by hand clears it; a setup that stores its own has the
    // same reason to.
    h.settings = {
      coolify: { previousAccessToken: { value: "1|old" } },
    } as Record<string, unknown>;

    await call("coolify-setup:inspect", TARGET);
    await checkThenRun();

    const saved = h.written.at(-1) as {
      coolify: { previousAccessToken?: unknown };
    };
    expect(saved.coolify.previousAccessToken).toBeUndefined();
  });

  it("refuses a server it has not looked at", async () => {
    // The form disables Install until the check has run, but this is the call
    // that sends the credentials, so it says no on its own account.
    await expect(call("coolify-setup:run", TARGET)).rejects.toThrow(
      /Check the server/,
    );
  });

  it("refuses a server whose check never finished", async () => {
    // The fingerprint is recorded during the handshake, before preflight has
    // said anything — so a connection that opened is not a check that passed.
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
      isPreviousConnection: true,
    });
  });

  it("hands back the token from before signing out", async () => {
    // Signing back in is then a paste, rather than a trip into Coolify to
    // mint a token Dyad already had.
    h.settings = {
      coolify: {
        instanceUrl: "http://203.0.113.5:8000",
        previousAccessToken: { value: "1|old" },
        adminEmail: "me@gmail.com",
        adminPassword: { value: "Abc123@xyz" },
        adminInstanceUrl: "http://203.0.113.5:8000",
      },
    };
    const result = (await call("coolify-setup:reveal-credentials")) as Record<
      string,
      unknown
    >;
    expect(result.apiToken).toBe("1|old");
  });

  it("prefers the live token over the one kept from before", async () => {
    h.settings = {
      coolify: {
        instanceUrl: "http://203.0.113.5:8000",
        accessToken: { value: "1|current" },
        previousAccessToken: { value: "1|old" },
      },
    };
    const result = (await call("coolify-setup:reveal-credentials")) as Record<
      string,
      unknown
    >;
    expect(result.apiToken).toBe("1|current");
  });

  it("recognises one server through its different spellings", async () => {
    // Dyad asks for a certificate under the sslip.io name, so the address it
    // stores can differ from the one the user types for the same box. Read as
    // two servers, the password for the one in front of them is hidden.
    h.settings = {
      coolify: {
        instanceUrl: "http://203.0.113.5:8000",
        accessToken: { value: "1|abc" },
        adminEmail: "me@gmail.com",
        adminPassword: { value: "Abc123@xyz" },
        adminInstanceUrl: "https://203.0.113.5.sslip.io",
      },
    };
    const result = (await call("coolify-setup:reveal-credentials")) as Record<
      string,
      unknown
    >;
    expect(result.adminPassword).toBe("Abc123@xyz");
  });

  it("still tells two different servers apart", async () => {
    h.settings = {
      coolify: {
        instanceUrl: "https://someone-else.example.com",
        accessToken: { value: "1|abc" },
        adminEmail: "me@gmail.com",
        adminPassword: { value: "Abc123@xyz" },
        adminInstanceUrl: "https://203.0.113.5.sslip.io",
      },
    };
    const result = (await call("coolify-setup:reveal-credentials")) as Record<
      string,
      unknown
    >;
    expect(result.adminPassword).toBeNull();
  });

  it("does not call a server with no token yet a previous connection", async () => {
    // Installed a moment ago, with no token minted for it. Calling it
    // previous reads as something being over.
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
    expect(result.isPreviousConnection).toBe(false);
  });

  it("describes one server, not two at once", async () => {
    // Connected to one Coolify, signed out, then installed another whose
    // token could not be minted. Showing the first one's address over the
    // second one's password reads as a way in and is not one.
    h.settings = {
      coolify: {
        instanceUrl: "https://old.example.com",
        previousAccessToken: { value: "1|for-the-old-one" },
        adminEmail: "me@gmail.com",
        adminPassword: { value: "PasswordForTheNewOne" },
        adminInstanceUrl: "http://203.0.113.5:8000",
      },
    };
    const result = (await call("coolify-setup:reveal-credentials")) as Record<
      string,
      unknown
    >;

    // The server Dyad installed: its password is what nothing else knows.
    expect(result.dashboardUrl).toBe("http://203.0.113.5:8000");
    expect(result.adminPassword).toBe("PasswordForTheNewOne");
    // The other instance's token would not open this one.
    expect(result.apiToken).toBeNull();
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

  it("keeps the connected instance as the subject while it is connected", async () => {
    // A live token means Dyad is talking to that one, so it is what the panel
    // is about — and the account from elsewhere is not shown beside it.
    h.settings = {
      coolify: {
        instanceUrl: "https://connected.example.com",
        accessToken: { value: "1|live" },
        adminEmail: "me@gmail.com",
        adminPassword: { value: "PasswordForElsewhere" },
        adminInstanceUrl: "http://203.0.113.5:8000",
      },
    };
    const result = (await call("coolify-setup:reveal-credentials")) as Record<
      string,
      unknown
    >;

    expect(result.dashboardUrl).toBe("https://connected.example.com");
    expect(result.apiToken).toBe("1|live");
    expect(result.adminPassword).toBeNull();
    expect(result.adminEmail).toBeNull();
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
